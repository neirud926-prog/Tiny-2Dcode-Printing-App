/**
 * The narrow API the renderer may call, exposed on `window.api` by the preload script.
 * The renderer has no Node access; every capability it needs is added here explicitly.
 * The main process treats everything the renderer sends as untrusted and validates it again.
 */

import type { LabelRequest } from '../core/label'
import type { PcSettings } from '../render/printSettings'

/** What the app found at startup. */
export type AppStartup =
  | {
      /** The app cannot write to its data folder: nothing else can work. */
      readonly status: 'folder-error'
      readonly message: string
      /** The system's reason, e.g. `EACCES: permission denied, mkdir '…'`. */
      readonly reason: string
    }
  | {
      readonly status: 'ready'
      readonly pcName: string
      readonly dataFolder: string
      /** `logs` in the data folder, used when the settings name no log folder. */
      readonly defaultLogFolder: string
      /** This PC's settings; null when this PC has not been set up (or its settings were refused). */
      readonly settings: PcSettings | null
      /** Why existing settings were not used (changed outside the app, or unreadable). */
      readonly settingsNotice: string | null
    }

/** An installed printer. */
export interface PrinterChoice {
  /** The system name, used as the print job's device name. */
  readonly name: string
  readonly displayName: string
}

export type PrintOutcome =
  | {
      readonly ok: true
      /** e.g. `Printed 3 labels on ZDesigner GX420t.` */
      readonly message: string
      /** Something to know although the print succeeded, e.g. the print log could not be written. */
      readonly warning: string | null
    }
  | { readonly ok: false; readonly message: string }

export type SaveSettingsOutcome = { readonly ok: true; readonly settings: PcSettings } | { readonly ok: false; readonly message: string }

export interface PreloadApi {
  /** Checks the data folder can be written and loads this PC's settings. */
  getStartup(): Promise<AppStartup>
  listPrinters(): Promise<PrinterChoice[]>
  /** Lets staff pick a log folder in the system dialog; null if cancelled. */
  chooseLogFolder(): Promise<string | null>
  /** Prints one sample label (TEST01, Lot TEST) with these settings, without saving them. Not logged. */
  testPrint(settings: PcSettings): Promise<PrintOutcome>
  savePrinterSettings(settings: PcSettings): Promise<SaveSettingsOutcome>
  /** Builds, self-checks and prints the label for this request, then adds a print log line. */
  printLabel(request: LabelRequest): Promise<PrintOutcome>
}

/** IPC channel for each API method. */
export const IPC_CHANNELS = {
  getStartup: 'get-startup',
  listPrinters: 'list-printers',
  chooseLogFolder: 'choose-log-folder',
  testPrint: 'test-print',
  savePrinterSettings: 'save-printer-settings',
  printLabel: 'print-label'
} as const satisfies Record<keyof PreloadApi, string>
