/**
 * The narrow API the renderer may call, exposed on `window.api` by the preload script.
 * The renderer has no Node access; every capability it needs is added here explicitly.
 * The main process treats everything the renderer sends as untrusted and validates it again.
 */

import type { ItemListEntry, ItemListImportResult, ItemListInfo } from '../core/itemList'
import type { LabelRequest } from '../core/label'
import type { PendingLabelInput, PendingLabelView } from '../core/pendingLabel'
import type { StockLot, StockOnhandImportResult, StockOnhandInfo } from '../core/stockOnhand'
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
      /** The Item List in use, shared by every PC; null when none has been imported (or it was refused). */
      readonly itemList: ItemListInfo | null
      /** Why an existing Item List was not used (changed outside the app, or unreadable). */
      readonly itemListNotice: string | null
      /** The Stock Onhand in use, shared by every PC, whatever its Report Date; null when none has been imported (or it was refused). */
      readonly stockOnhand: StockOnhandInfo | null
      /** Why an existing Stock Onhand was not used (changed outside the app, or unreadable). */
      readonly stockOnhandNotice: string | null
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

/** The result of an Item List import; `cancelled` when staff closed the file dialog. */
export type ImportItemListOutcome = ItemListImportResult | { readonly status: 'cancelled' }

/** The result of a Stock Onhand import; `cancelled` when staff closed the file dialog. */
export type ImportStockOnhandOutcome = StockOnhandImportResult | { readonly status: 'cancelled' }

/** An item's Lots in the Stock Onhand in use. */
export interface StockLotsLookup {
  /** The Stock Onhand in use, whatever its Report Date; null when none is imported. */
  readonly stockOnhand: StockOnhandInfo | null
  /** The item's Lots in it, in report order; empty when it has none. */
  readonly lots: readonly StockLot[]
}

/** What the Item List says about an Item Code. */
export type ItemLookup =
  | { readonly status: 'found'; readonly item: ItemListEntry; readonly itemList: ItemListInfo }
  | {
      readonly status: 'unknown'
      /** The Item Code looked up, a–z upper-cased. */
      readonly itemCode: string
      /** The Item List searched; null when none is imported. */
      readonly itemList: ItemListInfo | null
    }

/** The Pending Labels, each with what the Item List in use says about it now. */
export type PendingLabelsList = { readonly ok: true; readonly labels: readonly PendingLabelView[] } | { readonly ok: false; readonly message: string }

export type SavePendingOutcome = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly message: string }

export type DeletePendingOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string }

export type SaveSettingsOutcome = { readonly ok: true; readonly settings: PcSettings } | { readonly ok: false; readonly message: string }

export interface PreloadApi {
  /** Checks the data folder can be written and loads this PC's settings and the Item List. */
  getStartup(): Promise<AppStartup>
  /**
   * Lets staff choose `item_phq.txt` in the system file dialog and imports it as the Item List
   * (shared by every PC). A refused file leaves the Item List in use unchanged. Logged either way.
   */
  importItemList(): Promise<ImportItemListOutcome>
  /** Looks an Item Code up in the Item List in use (picking up a newer one another PC imported). */
  lookupItem(itemCode: string): Promise<ItemLookup>
  /**
   * Lets staff choose today's Stock Onhand report (`.ps`, `.txt` or `.csv`) in the system file dialog
   * and imports it (shared by every PC). A refused file leaves the Stock Onhand in use unchanged.
   * Logged either way.
   */
  importStockOnhand(): Promise<ImportStockOnhandOutcome>
  /** An item's Lots in the Stock Onhand in use (picking up a newer one another PC imported). */
  getStockLots(itemCode: string): Promise<StockLotsLookup>
  listPrinters(): Promise<PrinterChoice[]>
  /** Lets staff pick a log folder in the system dialog; null if cancelled. */
  chooseLogFolder(): Promise<string | null>
  /** Prints one sample label (TEST01, Lot TEST) with these settings, without saving them. Not logged. */
  testPrint(settings: PcSettings): Promise<PrintOutcome>
  savePrinterSettings(settings: PcSettings): Promise<SaveSettingsOutcome>
  /**
   * Builds, self-checks and checks against the Item List the label for this request, prints it,
   * then adds a print log line.
   */
  printLabel(request: LabelRequest): Promise<PrintOutcome>
  /**
   * Saves a label request whose Item Code is not in the Item List as a Pending Label in the shared
   * `pending.dat`. Everything but the Item List check applies, as for a label.
   */
  savePendingLabel(request: PendingLabelInput): Promise<SavePendingOutcome>
  /** The Pending Labels, checked against the Item List in use (picking up a newer one another PC imported). */
  listPendingLabels(): Promise<PendingLabelsList>
  /**
   * Prints a Pending Label whose Item Code is now listed, through the same checks, self-check and
   * print log as any label, then removes it. `packVolumeDigit` chooses the Pack Volume of a liquid saved without one.
   */
  printPendingLabel(id: string, packVolumeDigit: number | null): Promise<PrintOutcome>
  deletePendingLabel(id: string): Promise<DeletePendingOutcome>
}

/** IPC channel for each API method. */
export const IPC_CHANNELS = {
  getStartup: 'get-startup',
  importItemList: 'import-item-list',
  lookupItem: 'lookup-item',
  importStockOnhand: 'import-stock-onhand',
  getStockLots: 'get-stock-lots',
  listPrinters: 'list-printers',
  chooseLogFolder: 'choose-log-folder',
  testPrint: 'test-print',
  savePrinterSettings: 'save-printer-settings',
  printLabel: 'print-label',
  savePendingLabel: 'save-pending-label',
  listPendingLabels: 'list-pending-labels',
  printPendingLabel: 'print-pending-label',
  deletePendingLabel: 'delete-pending-label'
} as const satisfies Record<keyof PreloadApi, string>
