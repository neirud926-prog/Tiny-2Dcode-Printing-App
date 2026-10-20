//! The printer list and silent label printing for the Tauri app, through WinSpool and WebView2.
//! The print job comes from `src/render/printJob.ts`, so what reaches the driver is decided there.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterChoice {
    pub name: String,
    pub display_name: String,
}

/// `LabelPrintJob` from `src/render/printJob.ts`; the options' Electron-only fields are ignored.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelPrintJob {
    pub html: String,
    pub options: LabelPrintOptions,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelPrintOptions {
    pub device_name: String,
    pub page_size: PageSizeMicrons,
    pub copies: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSizeMicrons {
    pub width: u32,
    pub height: u32,
}

#[cfg(not(windows))]
const NEEDS_WINDOWS: &str = "Printing needs Windows.";

#[cfg(not(windows))]
pub fn list_printers() -> Result<Vec<PrinterChoice>, String> {
    Err(NEEDS_WINDOWS.into())
}

#[cfg(not(windows))]
pub async fn print_label(_app: tauri::AppHandle, _job: LabelPrintJob) -> Result<(), String> {
    Err(NEEDS_WINDOWS.into())
}

/// This PC's printers and the printer connections of the signed-in user.
#[cfg(windows)]
pub fn list_printers() -> Result<Vec<PrinterChoice>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
    };

    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut needed, mut count) = (0u32, 0u32);
    // The first call only asks for the buffer size, so its "buffer too small" error is expected.
    let _ = unsafe { EnumPrintersW(flags, PCWSTR::null(), 4, None, &mut needed, &mut count) };
    if needed == 0 {
        return Ok(Vec::new());
    }
    // u64 cells keep the PRINTER_INFO_4W records aligned.
    let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
    let bytes = unsafe {
        std::slice::from_raw_parts_mut(buffer.as_mut_ptr().cast::<u8>(), needed as usize)
    };
    unsafe {
        EnumPrintersW(
            flags,
            PCWSTR::null(),
            4,
            Some(bytes),
            &mut needed,
            &mut count,
        )
    }
    .map_err(|error| format!("could not list the printers: {error}"))?;
    let infos = unsafe {
        std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize)
    };
    infos
        .iter()
        .map(|info| {
            let name =
                unsafe { info.pPrinterName.to_string() }.map_err(|error| error.to_string())?;
            Ok(PrinterChoice {
                display_name: name.clone(),
                name,
            })
        })
        .collect()
}

/// Prints the label page silently: loads it in a hidden window that runs no scripts and can go
/// nowhere, prints it through WebView2 with the job's options, then closes the window.
#[cfg(windows)]
pub async fn print_label(app: tauri::AppHandle, job: LabelPrintJob) -> Result<(), String> {
    const PRINT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
    use std::sync::atomic::{AtomicU32, Ordering};
    use tauri::{async_runtime::channel, webview::PageLoadEvent, WebviewUrl, WebviewWindowBuilder};

    static NEXT_WINDOW: AtomicU32 = AtomicU32::new(0);

    let copies = i32::try_from(job.options.copies).map_err(|_| "too many copies".to_string())?;
    let url = html_data_url(&job.html)
        .parse()
        .map_err(|error| format!("the label page is not a valid URL: {error}"))?;
    let label = format!(
        "label-print-{}",
        NEXT_WINDOW.fetch_add(1, Ordering::Relaxed)
    );
    let (loaded_tx, mut loaded) = channel::<Result<(), String>>(1);
    let (done_tx, mut done) = channel::<Result<(), String>>(1);
    // A driver or page that never answers must not hang Print: give up after a minute.
    let (load_timeout, print_timeout) = (loaded_tx.clone(), done_tx.clone());
    std::thread::spawn(move || {
        std::thread::sleep(PRINT_TIMEOUT);
        let message = format!("no answer within {} seconds", PRINT_TIMEOUT.as_secs());
        let _ = load_timeout.try_send(Err(format!("the label page gave {message}")));
        let _ = print_timeout.try_send(Err(format!("the printer gave {message}")));
    });
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .visible(false)
        .disable_javascript()
        .on_navigation(|url| url.scheme() == "data")
        .on_page_load(move |_, page| {
            if page.event() == PageLoadEvent::Finished {
                let _ = loaded_tx.try_send(Ok(()));
            }
        })
        .build()
        .map_err(|error| format!("could not open the print window: {error}"))?;

    let result: Result<(), String> = async {
        loaded.recv().await.ok_or("the label page did not load")??;
        let options = job.options;
        window
            .with_webview(move |webview| {
                if let Err(error) = start_print(&webview, &options, copies, done_tx.clone()) {
                    let _ = done_tx.try_send(Err(hresult_error(error.code().0)));
                }
            })
            .map_err(|error| error.to_string())?;
        done.recv().await.ok_or("the print did not finish")?
    }
    .await;
    let _ = window.destroy();
    result
}

/// Starts the print; `done` gets its outcome when WebView2 has handed the job to the driver.
#[cfg(windows)]
fn start_print(
    webview: &tauri::webview::PlatformWebview,
    options: &LabelPrintOptions,
    copies: i32,
    done: tauri::async_runtime::Sender<Result<(), String>>,
) -> windows::core::Result<()> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PrintCompletedHandler};
    use windows::core::{Interface, HSTRING};

    const _: () = assert!(
        COREWEBVIEW2_PRINT_STATUS_SUCCEEDED.0 == PRINT_SUCCEEDED
            && COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE.0 == PRINT_PRINTER_UNAVAILABLE
    );

    unsafe {
        let core: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
        let settings = webview
            .environment()
            .cast::<ICoreWebView2Environment6>()?
            .CreatePrintSettings()?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
        settings.SetScaleFactor(1.0)?;
        settings.SetPageWidth(inches(options.page_size.width))?;
        settings.SetPageHeight(inches(options.page_size.height))?;
        settings.SetMarginTop(0.0)?;
        settings.SetMarginBottom(0.0)?;
        settings.SetMarginLeft(0.0)?;
        settings.SetMarginRight(0.0)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;
        let settings2: ICoreWebView2PrintSettings2 = settings.cast()?;
        settings2.SetPrinterName(&HSTRING::from(options.device_name.as_str()))?;
        settings2.SetCopies(copies)?;
        // Without a custom media size WebView2 keeps the driver's paper size, not PageWidth/PageHeight.
        settings2.SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)?;
        let handler = PrintCompletedHandler::create(Box::new(move |result, status| {
            let _ = done.try_send(print_outcome(
                result.err().map_or(0, |error| error.code().0),
                status.0,
            ));
            Ok(())
        }));
        core.Print(&settings, &handler)
    }
}

/// `COREWEBVIEW2_PRINT_STATUS` values (checked against webview2-com at compile time on Windows).
const PRINT_SUCCEEDED: i32 = 0;
const PRINT_PRINTER_UNAVAILABLE: i32 = 1;

/// What a finished WebView2 print means, from its HRESULT and `COREWEBVIEW2_PRINT_STATUS`.
#[cfg_attr(not(windows), allow(dead_code))]
fn print_outcome(hresult: i32, status: i32) -> Result<(), String> {
    if hresult < 0 {
        return Err(hresult_error(hresult));
    }
    match status {
        PRINT_SUCCEEDED => Ok(()),
        PRINT_PRINTER_UNAVAILABLE => Err("the printer is not available".into()),
        _ => Err(format!(
            "the printer driver reported an error (print status {status})"
        )),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn hresult_error(hresult: i32) -> String {
    format!("the print failed (HRESULT 0x{:08X})", hresult as u32)
}

/// WebView2 page sizes are in inches.
#[cfg_attr(not(windows), allow(dead_code))]
fn inches(microns: u32) -> f64 {
    f64::from(microns) / 25_400.0
}

/// The page as a `data:` URL, encoded like `htmlDataUrl` in `printJob.ts` (encodeURIComponent).
#[cfg_attr(not(windows), allow(dead_code))]
fn html_data_url(html: &str) -> String {
    let mut url = String::from("data:text/html;charset=utf-8,");
    for &byte in html.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            url.push(byte as char);
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_print_job_from_the_web_side() {
        let job: LabelPrintJob = serde_json::from_str(
            r#"{"html":"<p>x</p>","options":{"silent":true,"deviceName":"Zebra ZD421","printBackground":true,
            "margins":{"marginType":"none"},"landscape":false,"pageSize":{"width":34400,"height":25000},
            "copies":3,"scaleFactor":100}}"#,
        )
        .unwrap();
        assert_eq!(job.html, "<p>x</p>");
        assert_eq!(job.options.device_name, "Zebra ZD421");
        assert_eq!(
            (job.options.page_size.width, job.options.page_size.height),
            (34_400, 25_000)
        );
        assert_eq!(job.options.copies, 3);
    }

    #[test]
    fn page_size_is_in_inches() {
        assert_eq!(inches(25_400), 1.0);
        assert_eq!(inches(50_800), 2.0);
        assert!((inches(34_400) - 1.354_330_7).abs() < 1e-6);
    }

    #[test]
    fn print_status_becomes_the_driver_result() {
        assert_eq!(print_outcome(0, 0), Ok(()));
        assert_eq!(
            print_outcome(0, 1),
            Err("the printer is not available".into())
        );
        assert_eq!(
            print_outcome(0, 2),
            Err("the printer driver reported an error (print status 2)".into())
        );
        assert_eq!(
            print_outcome(0x8000_4004_u32 as i32, 0),
            Err("the print failed (HRESULT 0x80004004)".into())
        );
    }

    #[test]
    fn data_url_matches_encode_uri_component() {
        assert_eq!(
            html_data_url("<a b='c'>#é%</a>"),
            "data:text/html;charset=utf-8,%3Ca%20b%3D'c'%3E%23%C3%A9%25%3C%2Fa%3E"
        );
    }
}
