/**
 * What the host app (Electron or Tauri) supplies to the shared app service behind `window.api`:
 * where the data lives, who and where this PC is, and the few things only the host can do.
 */
import type { PrinterChoice } from '../preload/api'
import type { LabelPrintJob } from '../render/printJob'

/** What the printer driver said about a job. */
export type DriverResult = { ok: true } | { ok: false; reason: string }

export interface FileDialogFilter {
  readonly name: string
  readonly extensions: readonly string[]
}

export interface FileDialogOptions {
  readonly title: string
  /** `file`: choose one file to open; `folder`: choose (or create) a folder. */
  readonly kind: 'file' | 'folder'
  readonly filters?: readonly FileDialogFilter[]
  readonly defaultPath?: string
}

export interface AppHost {
  /** `LabelData` beside the `.exe`. */
  readonly dataFolder: string
  /** This PC's name, as `pcNameFromHostname` makes it. */
  readonly pcName: string
  /** The signed-in Windows user, for the logs. */
  readonly windowsUser: string
  /** Shows the system dialog; the chosen path, or null if cancelled. */
  chooseFile(options: FileDialogOptions): Promise<string | null>
  /** The installed printers. */
  listPrinters(): Promise<PrinterChoice[]>
  /** Prints the job silently; resolves with the driver's result. */
  sendToPrinter(job: LabelPrintJob): Promise<DriverResult>
}
