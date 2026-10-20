/**
 * The narrow API the screens may call on `window.api`, set by `src/tauri/main.ts` to the shared app
 * service (`src/app/service.ts`), which validates everything it is sent again.
 */

import type { ItemListEntry, ItemListImportResult, ItemListInfo } from '../core/itemList'
import type { LabelRequest } from '../core/label'
import type { PendingLabelInput, PendingLabelView } from '../core/pendingLabel'
import type { StockLot, StockOnhandImportResult, StockOnhandInfo } from '../core/stockOnhand'
import type { Template } from '../core/template'
import type { CustomLabelRequest } from '../render/customLabel'
import type { LabelSizeEntry, PcSettings } from '../render/printSettings'

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
/** `deleted` is how many expired Pending Labels were removed (0 if there were none). */
export type DeleteExpiredOutcome = { readonly ok: true; readonly deleted: number } | { readonly ok: false; readonly message: string }

export type SaveSettingsOutcome = { readonly ok: true; readonly settings: PcSettings } | { readonly ok: false; readonly message: string }

/** The Label Sizes, shared by every PC: the Small Label first, then those added. */
export type LabelSizesList = { readonly ok: true; readonly sizes: readonly LabelSizeEntry[] } | { readonly ok: false; readonly message: string }

/** The Templates: the built-in Layouts 1 and 2, then those staff saved, shared by every PC. */
export type TemplatesList = { readonly ok: true; readonly templates: readonly Template[] } | { readonly ok: false; readonly message: string }

/** After a Template save, copy, rename or delete: the Templates and the one saved (null after a delete). */
export type TemplateChangeOutcome =
  | {
      readonly ok: true
      readonly templates: readonly Template[]
      readonly template: Template | null
      /** e.g. the template log could not be written. */
      readonly warning: string | null
    }
  | { readonly ok: false; readonly message: string }

/** A Label Size to add. */
export interface NewLabelSize {
  readonly name: string
  readonly widthMm: number
  readonly heightMm: number
}

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
  /** Prints one sample label (TEST01, Lot TEST) on the loaded Label Size with its offsets, without saving the settings. Not logged. */
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
  /** Deletes every expired Pending Label (Expiry before this PC's today) in one locked change. */
  deleteExpiredPendingLabels(): Promise<DeleteExpiredOutcome>
  /** The Templates a Custom Label prints from: the built-in Layouts 1 and 2, then the saved ones (picking up changes from other PCs). */
  listTemplates(): Promise<TemplatesList>
  /**
   * Saves a Template in the shared `templates.dat`: a new one when its id is `''`, else replacing the
   * saved one with its id. Refused, with the reason, unless its name is new ignoring case and its
   * layout is valid on its Label Size. Built-ins cannot be saved. Logged either way.
   */
  /** `opened`: the stored version the designer started from; refused if another PC has changed it since. */
  saveTemplate(template: Template, opened?: Template | null): Promise<TemplateChangeOutcome>
  /** Renames a saved Template (name new ignoring case). Logged. */
  renameTemplate(id: string, name: string): Promise<TemplateChangeOutcome>
  /** Copies a built-in or saved Template, positions and all, under a new name. Logged. */
  copyTemplate(id: string, name: string): Promise<TemplateChangeOutcome>
  /** Deletes a saved Template. Logged. */
  deleteTemplate(id: string): Promise<TemplateChangeOutcome>
  /**
   * Rebuilds and checks the Custom Label for this request from its Template, refuses it unless the
   * Template was made for the Label Size loaded in this PC's printer, prints it with that size's
   * offsets, then adds a print log line (Kind Custom).
   */
  printCustomLabel(request: CustomLabelRequest): Promise<PrintOutcome>
  /** The Label Sizes (picking up sizes another PC added). */
  listLabelSizes(): Promise<LabelSizesList>
  /** Adds a Label Size to the shared list (name unique ignoring case); the list after. */
  addLabelSize(size: NewLabelSize): Promise<LabelSizesList>
  /** Deletes an added Label Size, unless it is the Small Label, used by a Template or loaded in this PC's printer; the list after. */
  deleteLabelSize(id: string): Promise<LabelSizesList>
}
