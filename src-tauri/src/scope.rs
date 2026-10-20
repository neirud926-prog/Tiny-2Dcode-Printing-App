//! Which paths the webview's file commands may touch, and Node-style codes for io errors.
//!
//! Pure std (no Tauri), so the tests also run where Tauri cannot link:
//! `rustc --edition 2021 --test src/scope.rs -o <scratch>/scope-tests && <scratch>/scope-tests`.
//! Paths are compared as Windows paths: `\` or `/` separators, case-insensitive, absolute only, and
//! no `.` or `..` parts (refused rather than resolved, so a path cannot climb out of a folder).

use std::io;

/// A path split into its absolute prefix (`c:`, `//` for UNC, `/`) and lower-cased parts.
type Parts = Vec<String>;

#[derive(Default)]
pub struct Scope {
    data_folder: Option<Parts>,
    /// Files staff chose in the open dialog this session: readable.
    chosen_files: Vec<Parts>,
    /// Folders staff chose in the folder dialog this session: writable.
    chosen_folders: Vec<Parts>,
}

impl Scope {
    pub fn new(data_folder: &str) -> Scope {
        Scope {
            data_folder: parts(data_folder),
            ..Scope::default()
        }
    }

    pub fn add_chosen_file(&mut self, path: &str) {
        self.chosen_files.extend(parts(path));
    }

    pub fn add_chosen_folder(&mut self, path: &str) {
        self.chosen_folders.extend(parts(path));
    }

    /// Inside the data folder or a chosen folder; or, in any folder, a log file or the write probe
    /// (so a log folder saved in an earlier session keeps working).
    pub fn may_write(&self, path: &str) -> bool {
        let Some(p) = parts(path) else { return false };
        let inside = |folder: &Parts| p.len() >= folder.len() && p[..folder.len()] == folder[..];
        self.data_folder
            .iter()
            .chain(&self.chosen_folders)
            .any(inside)
            || is_log_or_probe(file_name(path))
    }

    /// Anything writable, and the files chosen in the open dialog.
    pub fn may_read(&self, path: &str) -> bool {
        self.may_write(path) || parts(path).is_some_and(|p| self.chosen_files.contains(&p))
    }
}

fn parts(path: &str) -> Option<Parts> {
    let is_sep = |c: char| c == '\\' || c == '/';
    let bytes = path.as_bytes();
    let (prefix, rest) = if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && is_sep(bytes[2] as char)
    {
        (path[..2].to_lowercase(), &path[3..])
    } else if path.starts_with(r"\\") || path.starts_with("//") {
        ("//".to_string(), &path[2..])
    } else if path.starts_with(is_sep) {
        ("/".to_string(), &path[1..])
    } else {
        return None; // relative, or drive-relative like `C:x`
    };
    let mut out = vec![prefix];
    for part in rest.split(is_sep).filter(|s| !s.is_empty()) {
        // Windows drops trailing dots and spaces, so `..` and `. .` are both a parent folder.
        if part.trim_end_matches(['.', ' ']).is_empty() {
            return None;
        }
        out.push(part.to_lowercase());
    }
    Some(out)
}

fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or("")
}

/// `print-log-YYYY-MM-<PC>.csv`, `import-log-YYYY-MM-<PC>.csv` or `.write-check-<id>`.
fn is_log_or_probe(name: &str) -> bool {
    if let Some(id) = name.strip_prefix(".write-check-") {
        return (1..=64).contains(&id.len())
            && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    }
    let Some(rest) = name
        .strip_prefix("print-log-")
        .or_else(|| name.strip_prefix("import-log-"))
    else {
        return false;
    };
    let Some(rest) = rest.strip_suffix(".csv") else {
        return false;
    };
    let b = rest.as_bytes();
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    // YYYY-MM-<PC>, the PC name as pcNameFromHostname makes it.
    b.len() > 8
        && b.len() <= 8 + 63
        && digits(0..4)
        && b[4] == b'-'
        && digits(5..7)
        && b[7] == b'-'
        && b[8..]
            .iter()
            .all(|&c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
}

/// The Node (libuv) code for an io error, as the data layer checks it.
pub fn error_code(error: &io::Error) -> &'static str {
    #[cfg(windows)]
    if let Some(code) = error.raw_os_error().and_then(windows_code) {
        return code;
    }
    match error.kind() {
        io::ErrorKind::NotFound => "ENOENT",
        io::ErrorKind::AlreadyExists => "EEXIST",
        io::ErrorKind::PermissionDenied => "EACCES",
        io::ErrorKind::ResourceBusy => "EBUSY",
        io::ErrorKind::NotADirectory => "ENOTDIR",
        io::ErrorKind::IsADirectory => "EISDIR",
        io::ErrorKind::DirectoryNotEmpty => "ENOTEMPTY",
        io::ErrorKind::StorageFull => "ENOSPC",
        io::ErrorKind::ReadOnlyFilesystem => "EROFS",
        io::ErrorKind::CrossesDevices => "EXDEV",
        io::ErrorKind::InvalidInput | io::ErrorKind::InvalidFilename => "EINVAL",
        _ => "EIO",
    }
}

/// Windows error codes as libuv maps them (`uv_translate_sys_error`), so codes match the Electron app.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_code(raw: i32) -> Option<&'static str> {
    Some(match raw {
        2 | 3 | 15 | 53 | 67 | 123 | 161 => "ENOENT", // FILE/PATH_NOT_FOUND, INVALID_DRIVE, BAD_NETPATH, BAD_NET_NAME, INVALID_NAME, BAD_PATHNAME
        5 => "EPERM",                                 // ACCESS_DENIED
        32 | 33 => "EBUSY",                           // SHARING_VIOLATION, LOCK_VIOLATION
        80 | 183 => "EEXIST",                         // FILE_EXISTS, ALREADY_EXISTS
        267 => "ENOTDIR",                             // DIRECTORY
        145 => "ENOTEMPTY",                           // DIR_NOT_EMPTY
        17 => "EXDEV",                                // NOT_SAME_DEVICE
        39 | 112 => "ENOSPC",                         // HANDLE_DISK_FULL, DISK_FULL
        19 => "EROFS",                                // WRITE_PROTECT
        998 | 740 | 1920 => "EACCES", // NOACCESS, ELEVATION_REQUIRED, CANT_ACCESS_FILE
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> Scope {
        let mut scope = Scope::new(r"S:\Pharmacy\Label App\LabelData");
        scope.add_chosen_file(r"C:\Users\amy\Downloads\item_phq.txt");
        scope.add_chosen_folder(r"\\files\pharm\Logs");
        scope
    }

    #[test]
    fn allows_the_data_folder_and_anything_inside_it() {
        let s = scope();
        assert!(s.may_write(r"S:\Pharmacy\Label App\LabelData"));
        assert!(s.may_write(r"S:\Pharmacy\Label App\LabelData\pcs\PHARM-01.dat"));
        assert!(s.may_write(r"s:/pharmacy/label app/labeldata/items.dat.tmp-0a1b"));
        assert!(s.may_read(r"S:\Pharmacy\Label App\LabelData\pending.lock"));
    }

    #[test]
    fn refuses_paths_outside_or_climbing_out() {
        let s = scope();
        assert!(!s.may_write(r"S:\Pharmacy\Label App\LabelData2\items.dat"));
        assert!(!s.may_write(r"S:\Pharmacy\Label App\items.dat"));
        assert!(!s.may_write(r"S:\Pharmacy\Label App\LabelData\..\evil.exe"));
        assert!(!s.may_write(r"S:\Pharmacy\Label App\LabelData\. .\evil.exe"));
        assert!(!s.may_write(r"S:\Pharmacy\Label App\LabelData\.\items.dat"));
        assert!(!s.may_read(r"C:\Windows\win.ini"));
        assert!(!s.may_write(r"LabelData\items.dat"));
        assert!(!s.may_write(r"S:LabelData\items.dat"));
        assert!(!s.may_write(""));
    }

    #[test]
    fn chosen_files_are_readable_only() {
        let s = scope();
        assert!(s.may_read(r"C:\Users\amy\Downloads\item_phq.txt"));
        assert!(!s.may_write(r"C:\Users\amy\Downloads\item_phq.txt"));
        assert!(!s.may_read(r"C:\Users\amy\Downloads\other.txt"));
    }

    #[test]
    fn chosen_folders_are_writable() {
        let s = scope();
        assert!(s.may_write(r"\\files\pharm\Logs\anything.txt"));
        assert!(!s.may_write(r"\\files\pharm\Other\anything.txt"));
        assert!(!s.may_write(r"\files\pharm\Logs\anything.txt"));
    }

    #[test]
    fn log_files_and_the_write_probe_are_writable_in_any_folder() {
        let s = scope();
        assert!(s.may_write(r"D:\Old Logs\print-log-2026-10-PHARM-01.csv"));
        assert!(s.may_write(r"D:\Old Logs\import-log-2026-01-UNKNOWN-PC.csv"));
        assert!(s.may_write(r"D:\Old Logs\.write-check-0a1b2c3d4e5f"));
        assert!(s.may_read(r"D:\Old Logs\print-log-2026-10-PHARM_01.csv"));
        assert!(!s.may_write(r"D:\Old Logs\print-log-2026-10-.csv"));
        assert!(!s.may_write(r"D:\Old Logs\print-log-2026-10-pharm.csv"));
        assert!(!s.may_write(r"D:\Old Logs\print-log-26-10-PHARM.csv"));
        assert!(!s.may_write(r"D:\Old Logs\print-log-2026-10-PHARM.csv.exe"));
        assert!(!s.may_write(r"D:\Old Logs\print-log-2026-10-PHARM.csv:stream"));
        assert!(!s.may_write(r"D:\Old Logs\.write-check-"));
        assert!(!s.may_write(r"D:\Old Logs\..\print-log-2026-10-PHARM.csv"));
        assert!(!s.may_write(r"D:\Old Logs\other.csv"));
    }

    #[test]
    fn windows_codes_match_libuv() {
        assert_eq!(windows_code(2), Some("ENOENT"));
        assert_eq!(windows_code(3), Some("ENOENT"));
        assert_eq!(windows_code(5), Some("EPERM"));
        assert_eq!(windows_code(32), Some("EBUSY"));
        assert_eq!(windows_code(33), Some("EBUSY"));
        assert_eq!(windows_code(80), Some("EEXIST"));
        assert_eq!(windows_code(183), Some("EEXIST"));
        assert_eq!(windows_code(267), Some("ENOTDIR"));
        assert_eq!(windows_code(1), None);
    }

    #[test]
    fn error_kinds_map_to_node_codes() {
        let code = |kind| error_code(&io::Error::from(kind));
        assert_eq!(code(io::ErrorKind::NotFound), "ENOENT");
        assert_eq!(code(io::ErrorKind::AlreadyExists), "EEXIST");
        assert_eq!(code(io::ErrorKind::PermissionDenied), "EACCES");
        assert_eq!(code(io::ErrorKind::Other), "EIO");
    }
}
