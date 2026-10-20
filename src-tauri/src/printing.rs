//! Printers and silent label printing. A stub until the printing ticket replaces this file wholesale.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterChoice {
    pub name: String,
    pub display_name: String,
}

/// The print job from `src/render/printJob.ts`; other fields are ignored.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LabelPrintJob {
    pub html: String,
    pub options: LabelPrintOptions,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct LabelPrintOptions {
    pub device_name: String,
    pub page_size: PageSizeMicrons,
    pub copies: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PageSizeMicrons {
    pub width: u32,
    pub height: u32,
}

const NOT_YET: &str = "Printing is not available in this build yet.";

pub fn list_printers() -> Result<Vec<PrinterChoice>, String> {
    Err(NOT_YET.to_string())
}

pub async fn print_label(_app: tauri::AppHandle, _job: LabelPrintJob) -> Result<(), String> {
    Err(NOT_YET.to_string())
}
