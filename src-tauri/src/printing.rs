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
    /// None (`null`): use the driver's paper, for a Tape Size (ADR 0004).
    pub page_size: Option<PageSizeMicrons>,
    pub copies: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSizeMicrons {
    pub width: u32,
    pub height: u32,
}

/// `DriverPaper` in `src/app/host.ts`: a printer driver's default paper in mm.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPaper {
    pub width_mm: f64,
    pub length_mm: Option<f64>,
}

#[cfg(not(windows))]
const NEEDS_WINDOWS: &str = "Printing needs Windows.";

/// Off Windows no driver can be asked.
#[cfg(not(windows))]
pub fn default_paper(_printer_name: &str) -> Option<DriverPaper> {
    None
}

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

/// The default paper in the driver's Printing preferences for `printer_name` (its default DEVMODE),
/// or None if the driver cannot be asked or reports no width (`paper::paper_mm`).
#[cfg(windows)]
pub fn default_paper(printer_name: &str) -> Option<DriverPaper> {
    use crate::paper::{paper_mm, DevmodePaper};
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{DEVMODEW, DM_OUT_BUFFER};
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, DocumentPropertiesW, OpenPrinterW, PRINTER_HANDLE,
    };
    use windows::Win32::Storage::Xps::{DeviceCapabilitiesW, DC_PAPERS, DC_PAPERSIZE};

    let name = HSTRING::from(printer_name);
    let mut printer = PRINTER_HANDLE::default();
    unsafe { OpenPrinterW(&name, &mut printer, None) }.ok()?;
    let devmode = (|| {
        // The first call only asks for the DEVMODE's size, driver data included.
        let size = unsafe { DocumentPropertiesW(None, printer, &name, None, None, 0) };
        if size <= 0 {
            return None;
        }
        // u64 cells keep the DEVMODEW aligned.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let devmode = buffer.as_mut_ptr().cast::<DEVMODEW>();
        let filled = unsafe {
            DocumentPropertiesW(None, printer, &name, Some(devmode), None, DM_OUT_BUFFER.0)
        };
        if filled < 0 {
            return None;
        }
        let devmode = unsafe { &*devmode };
        let paper = unsafe { devmode.Anonymous1.Anonymous1 };
        Some(DevmodePaper {
            fields: devmode.dmFields.0,
            paper_size: paper.dmPaperSize,
            paper_length: paper.dmPaperLength,
            paper_width: paper.dmPaperWidth,
        })
    })();
    let _ = unsafe { ClosePrinter(printer) };
    let devmode = devmode?;

    // The driver's named papers and their sizes, for a DEVMODE that names its paper only by id.
    let count = unsafe { DeviceCapabilitiesW(&name, PCWSTR::null(), DC_PAPERS, None, None) };
    let (mut papers, mut sizes) = (Vec::new(), Vec::new());
    if count > 0 {
        papers = vec![0u16; count as usize];
        let mut points = vec![POINT::default(); count as usize];
        let got_papers = unsafe {
            DeviceCapabilitiesW(
                &name,
                PCWSTR::null(),
                DC_PAPERS,
                Some(PWSTR(papers.as_mut_ptr())),
                None,
            )
        };
        let got_sizes = unsafe {
            DeviceCapabilitiesW(
                &name,
                PCWSTR::null(),
                DC_PAPERSIZE,
                Some(PWSTR(points.as_mut_ptr().cast())),
                None,
            )
        };
        if got_papers == count && got_sizes == count {
            sizes = points.iter().map(|point| (point.x, point.y)).collect();
        } else {
            papers.clear();
        }
    }
    paper_mm(&devmode, &papers, &sizes).map(|(width_mm, length_mm)| DriverPaper {
        width_mm,
        length_mm,
    })
}

/// Prints the label page silently: a hidden window that runs no scripts is given the page by
/// WebView2 itself (`NavigateToString`), and once WebView2 says the page loaded it prints it with the
/// job's options, then the window is closed.
///
/// The page is not loaded through Tauri: Tauri rewrites a `data:` page to add the app's CSP, which
/// puts the raw HTML into the URL, and then drops the page-load event when that URL does not parse
/// back, so Print waited forever (v0.2.0).
#[cfg(windows)]
pub async fn print_label(app: tauri::AppHandle, job: LabelPrintJob) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::{async_runtime::channel, webview::PageLoadEvent, WebviewUrl, WebviewWindowBuilder};

    const BLANK_WAIT: Duration = Duration::from_secs(5);
    const LOAD_TIMEOUT: Duration = Duration::from_secs(60);
    static NEXT_WINDOW: AtomicU32 = AtomicU32::new(0);

    let copies = i32::try_from(job.options.copies).map_err(|_| "too many copies".to_string())?;
    let label = format!(
        "label-print-{}",
        NEXT_WINDOW.fetch_add(1, Ordering::Relaxed)
    );
    let (blank_tx, mut blank) = channel::<()>(1);
    let (done_tx, mut done) = channel::<Result<(), String>>(1);
    // Set once the label page has loaded and the print started: from then on there is no limit, as
    // in the Electron app, since giving up could not stop a label already sent to the printer.
    let started = Arc::new(AtomicBool::new(false));
    {
        let (blank_tx, done_tx, started) = (blank_tx.clone(), done_tx.clone(), started.clone());
        std::thread::spawn(move || {
            std::thread::sleep(BLANK_WAIT);
            let _ = blank_tx.try_send(());
            std::thread::sleep(LOAD_TIMEOUT);
            if !started.load(Ordering::SeqCst) {
                let seconds = LOAD_TIMEOUT.as_secs();
                let _ = done_tx.try_send(Err(format!(
                    "the label page did not load within {seconds} seconds"
                )));
            }
        });
    }
    let window = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External("about:blank".parse().expect("about:blank is a URL")),
    )
    .visible(false)
    .disable_javascript()
    .on_page_load(move |_, page| {
        if page.event() == PageLoadEvent::Finished {
            let _ = blank_tx.try_send(());
        }
    })
    .build()
    .map_err(|error| format!("could not open the print window: {error}"))?;

    let result: Result<(), String> = async {
        // The blank page loads first, so the next navigation to finish is the label's.
        blank.recv().await;
        let (html, options) = (job.html, job.options);
        window
            .with_webview(move |webview| {
                if let Err(error) =
                    load_and_print(&webview, &html, options, copies, done_tx.clone(), started)
                {
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

/// Gives WebView2 the page and, when it has loaded, starts the print (`start_print`).
#[cfg(windows)]
fn load_and_print(
    webview: &tauri::webview::PlatformWebview,
    html: &str,
    options: LabelPrintOptions,
    copies: i32,
    done: tauri::async_runtime::Sender<Result<(), String>>,
    started: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> windows::core::Result<()> {
    use std::sync::atomic::Ordering;
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler};
    use windows::core::{BOOL, HSTRING};

    unsafe {
        let core = webview.controller().CoreWebView2()?;
        let environment = webview.environment().clone();
        let printer = core.clone();
        let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            if started.swap(true, Ordering::SeqCst) {
                return Ok(()); // only the label page's navigation counts
            }
            let mut loaded = BOOL::default();
            args.IsSuccess(&mut loaded)?;
            if !loaded.as_bool() {
                let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                args.WebErrorStatus(&mut status)?;
                let _ = done.try_send(Err(format!(
                    "the label page did not load (WebView2 error {})",
                    status.0
                )));
                return Ok(());
            }
            if let Err(error) = start_print(&printer, &environment, &options, copies, done.clone())
            {
                let _ = done.try_send(Err(hresult_error(error.code().0)));
            }
            Ok(())
        }));
        let mut token = 0i64;
        core.add_NavigationCompleted(&handler, &mut token)?;
        core.NavigateToString(&HSTRING::from(html))
    }
}

/// Starts the print; `done` gets its outcome when WebView2 has handed the job to the driver.
#[cfg(windows)]
fn start_print(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    environment: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment,
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
        let core: ICoreWebView2_16 = core.cast()?;
        let settings = environment
            .cast::<ICoreWebView2Environment6>()?
            .CreatePrintSettings()?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
        settings.SetScaleFactor(1.0)?;
        if let Some(page_size) = &options.page_size {
            settings.SetPageWidth(inches(page_size.width))?;
            settings.SetPageHeight(inches(page_size.height))?;
        }
        settings.SetMarginTop(0.0)?;
        settings.SetMarginBottom(0.0)?;
        settings.SetMarginLeft(0.0)?;
        settings.SetMarginRight(0.0)?;
        settings.SetShouldPrintBackgrounds(true)?;
        settings.SetShouldPrintHeaderAndFooter(false)?;
        let settings2: ICoreWebView2PrintSettings2 = settings.cast()?;
        settings2.SetPrinterName(&HSTRING::from(options.device_name.as_str()))?;
        settings2.SetCopies(copies)?;
        // Without a custom media size WebView2 keeps the driver's paper size, not PageWidth/PageHeight;
        // on tape that is what is wanted: the tape set in the driver's Printing preferences.
        if options.page_size.is_some() {
            settings2.SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)?;
        }
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
        let page_size = job.options.page_size.unwrap();
        assert_eq!((page_size.width, page_size.height), (34_400, 25_000));
        assert_eq!(job.options.copies, 3);
    }

    #[test]
    fn a_tape_job_uses_the_drivers_paper() {
        let job: LabelPrintJob = serde_json::from_str(
            r#"{"html":"<p>x</p>","options":{"silent":true,"deviceName":"Brother PT-P900W","printBackground":true,
            "margins":{"marginType":"none"},"landscape":false,"pageSize":null,"copies":1,"scaleFactor":100}}"#,
        )
        .unwrap();
        assert!(job.options.page_size.is_none());
        assert_eq!(job.options.device_name, "Brother PT-P900W");
    }

    #[test]
    fn the_drivers_paper_goes_to_the_web_side_in_mm() {
        let paper = DriverPaper {
            width_mm: 23.9,
            length_mm: None,
        };
        assert_eq!(
            serde_json::to_string(&paper).unwrap(),
            r#"{"widthMm":23.9,"lengthMm":null}"#
        );
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
}
