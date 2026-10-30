//! 2D Code Print on WebView2. The app logic runs in the webview (`src/tauri/main.ts`); Rust gives it
//! only primitives: file operations limited by `scope.rs`, the open/folder dialog, who and where this
//! PC is, and printing (`printing.rs`).

// No console window in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod paper;
mod printing;
mod scope;

use scope::{error_code, Scope};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{ipc::Response, AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

struct Files {
    data_folder: String,
    scope: Mutex<Scope>,
}

/// A failed file command; the webview makes it an Error with this Node-style `code`.
#[derive(serde::Serialize)]
struct FsError {
    code: &'static str,
    message: String,
}

type FsResult<T> = Result<T, FsError>;

fn failed(error: io::Error, op: &str, path: &str) -> FsError {
    let code = error_code(&error);
    FsError {
        code,
        message: format!("{code}: {error}, {op} '{path}'"),
    }
}

fn allowed(allowed: bool, op: &str, path: &str) -> FsResult<()> {
    if allowed {
        return Ok(());
    }
    Err(FsError {
        code: "EACCES",
        message: format!("EACCES: outside the folders the app may use, {op} '{path}'"),
    })
}

#[tauri::command]
async fn read_file(files: State<'_, Files>, path: String) -> FsResult<Response> {
    allowed(files.scope.lock().unwrap().may_read(&path), "open", &path)?;
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| failed(e, "open", &path))
}

/// Creates `path` (EEXIST if it exists), writes `data` and flushes it to disk.
#[tauri::command]
async fn create_file(files: State<'_, Files>, path: String, data: Vec<u8>) -> FsResult<()> {
    allowed(files.scope.lock().unwrap().may_add(&path), "open", &path)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| failed(e, "open", &path))?;
    file.write_all(&data)
        .and_then(|()| file.sync_all())
        .map_err(|e| failed(e, "write", &path))
}

#[tauri::command]
async fn append_file(files: State<'_, Files>, path: String, data: Vec<u8>) -> FsResult<()> {
    allowed(files.scope.lock().unwrap().may_add(&path), "open", &path)?;
    let mut file = OpenOptions::new()
        .append(true)
        .create(true)
        .open(&path)
        .map_err(|e| failed(e, "open", &path))?;
    file.write_all(&data).map_err(|e| failed(e, "write", &path))
}

/// Replaces `to` if it exists (on Windows std renames with MoveFileEx REPLACE_EXISTING semantics).
#[tauri::command]
async fn rename(files: State<'_, Files>, from: String, to: String) -> FsResult<()> {
    {
        let scope = files.scope.lock().unwrap();
        allowed(scope.may_write(&from), "rename", &from)?;
        allowed(scope.may_write(&to), "rename", &to)?;
    }
    fs::rename(&from, &to).map_err(|e| failed(e, "rename", &format!("{from}' -> '{to}")))
}

#[tauri::command]
async fn unlink(files: State<'_, Files>, path: String) -> FsResult<()> {
    allowed(
        files.scope.lock().unwrap().may_unlink(&path),
        "unlink",
        &path,
    )?;
    fs::remove_file(&path).map_err(|e| failed(e, "unlink", &path))
}

/// Creates the folder and missing parents. Outside the writable places an existing folder is fine,
/// so a log folder saved in an earlier session still passes; one that is gone must be chosen again
/// in Settings (the Electron app would recreate it), and one that cannot be reached says why.
#[tauri::command]
async fn mkdir_all(files: State<'_, Files>, path: String) -> FsResult<()> {
    if files.scope.lock().unwrap().may_write(&path) {
        return fs::create_dir_all(&path).map_err(|e| failed(e, "mkdir", &path));
    }
    match fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => Ok(()),
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(failed(e, "mkdir", &path)),
        Ok(_) => allowed(false, "mkdir", &path),
        Err(_) => Err(FsError {
            code: "ENOENT",
            message: format!("ENOENT: the folder no longer exists; choose the log folder again in Settings, mkdir '{path}'"),
        }),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStats {
    size: u64,
    mtime_ms: f64,
}

#[tauri::command]
async fn stat(files: State<'_, Files>, path: String) -> FsResult<FileStats> {
    allowed(files.scope.lock().unwrap().may_read(&path), "stat", &path)?;
    let meta = fs::metadata(&path).map_err(|e| failed(e, "stat", &path))?;
    let modified = meta.modified().map_err(|e| failed(e, "stat", &path))?;
    let mtime_ms = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as f64
        / 1e6;
    Ok(FileStats {
        size: meta.len(),
        mtime_ms,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupInfo {
    data_folder: String,
    /// The PC name comes from this, through pcNameFromHostname as in the Electron app.
    hostname: String,
    windows_user: String,
}

#[tauri::command]
fn startup_info(files: State<'_, Files>) -> StartupInfo {
    StartupInfo {
        data_folder: files.data_folder.clone(),
        hostname: hostname(),
        windows_user: std::env::var("USERNAME").unwrap_or_default(),
    }
}

/// `src/app/host.ts` FileDialogOptions.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileDialogOptions {
    title: String,
    kind: DialogKind,
    #[serde(default)]
    filters: Vec<DialogFilter>,
    default_path: Option<String>,
}

#[derive(serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum DialogKind {
    File,
    Folder,
}

#[derive(serde::Deserialize)]
struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

/// Shows the open or folder dialog over the window; the chosen path, which the file commands may
/// then read (a file) or write in (a folder) for the rest of the session. None if cancelled.
#[tauri::command]
async fn choose_file(
    window: WebviewWindow,
    files: State<'_, Files>,
    options: FileDialogOptions,
) -> Result<Option<String>, String> {
    let mut dialog = window
        .dialog()
        .file()
        .set_title(options.title)
        .set_parent(&window);
    for filter in &options.filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    if let Some(path) = &options.default_path {
        dialog = dialog.set_directory(path);
    }
    let chosen = if options.kind == DialogKind::Folder {
        dialog.blocking_pick_folder()
    } else {
        dialog.blocking_pick_file()
    };
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    let mut scope = files.scope.lock().unwrap();
    match options.kind {
        DialogKind::File => scope.add_chosen_file(&path),
        DialogKind::Folder => scope.add_chosen_folder(&path),
    }
    Ok(Some(path))
}

#[tauri::command]
async fn list_printers() -> Result<Vec<printing::PrinterChoice>, String> {
    printing::list_printers()
}

/// The printer's default paper in its Printing preferences, or null (`readDefaultPaper` in the host).
#[tauri::command]
async fn default_paper(printer_name: String) -> Option<printing::DriverPaper> {
    printing::default_paper(&printer_name)
}

#[tauri::command]
async fn print_label(app: AppHandle, job: printing::LabelPrintJob) -> Result<(), String> {
    printing::print_label(app, job).await
}

/// `LabelData` beside the `.exe`; in development, in the project folder (git-ignored), as for Electron.
fn data_folder() -> PathBuf {
    let base = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project folder")
            .to_path_buf()
    } else {
        let exe = std::env::current_exe().expect("the app's own path");
        exe.parent().expect("the app's folder").to_path_buf()
    };
    base.join("LabelData")
}

/// The DNS host name, as Node's `os.hostname()` gives it to the Electron app.
#[cfg(windows)]
fn hostname() -> String {
    use windows_sys::Win32::System::SystemInformation::{
        ComputerNameDnsHostname, GetComputerNameExW,
    };
    let mut buffer = [0u16; 256];
    let mut len = buffer.len() as u32;
    // SAFETY: the buffer and its length in u16s are valid; on success len is the name's length.
    if unsafe { GetComputerNameExW(ComputerNameDnsHostname, buffer.as_mut_ptr(), &mut len) } == 0 {
        return std::env::var("COMPUTERNAME").unwrap_or_default();
    }
    String::from_utf16_lossy(&buffer[..len as usize])
}

#[cfg(not(windows))]
fn hostname() -> String {
    fs::read_to_string("/etc/hostname")
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn main() {
    let data_folder = data_folder().to_string_lossy().into_owned();
    tauri::Builder::default()
        // First, so a second launch only focuses the window already open.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Files {
            scope: Mutex::new(Scope::new(&data_folder)),
            data_folder,
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            create_file,
            append_file,
            rename,
            unlink,
            mkdir_all,
            stat,
            startup_info,
            choose_file,
            list_printers,
            default_paper,
            print_label
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
