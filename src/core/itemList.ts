/**
 * The Item List: the HA drug master `item_phq.txt` imported into the app, the source of valid Item
 * Codes. This module parses the file's text, looks Item Codes up, and holds the Item List rules for a
 * label (the Item Code must be listed; only a liquid has a Pack Volume).
 *
 * `item_phq.txt` is tab-separated with no header row (CRLF or LF). Only three columns are kept:
 * 0 Item Code, 1 drug name, 14 base unit (`ML` means a liquid). The caller decodes the file as latin1.
 *
 * Pure: no Node, DOM or Electron, never reads the clock.
 */

import { encodeInternalGtin, PACK_VOLUMES } from './internalGtin'
import type { FieldMessage } from './label'

/** The columns kept from each row (0-based). */
export const ITEM_LIST_COLUMNS = { itemCode: 0, name: 1, baseUnit: 14 } as const

/** A row needs at least this many columns to reach the base unit. */
export const ITEM_LIST_MIN_COLUMNS = ITEM_LIST_COLUMNS.baseUnit + 1

/** The base unit of a liquid, the only kind of item with a Pack Volume. */
export const LIQUID_BASE_UNIT = 'ML'

/** A file with more bad rows than this share of its rows is refused. */
export const MAX_BAD_ROW_SHARE = 0.01

/** How many bad rows a parse result lists (all are counted). */
export const MAX_LISTED_BAD_ROWS = 10

/** One item of the Item List. */
export interface ItemListEntry {
  /** Upper-case, exactly 6 characters from the 40 of ADR-0002. */
  readonly itemCode: string
  /** Shown on screen to confirm the item; never printed on the label. */
  readonly name: string
  /** Upper-case, e.g. `TAB`, `ML`. */
  readonly baseUnit: string
}

/** What a file held. */
export interface ItemListSummary {
  /** Non-blank lines read. */
  readonly rows: number
  /** Items kept: valid rows, less duplicates. */
  readonly items: number
  /** Items whose base unit is `ML`. */
  readonly liquids: number
  readonly badRows: number
  /** Rows skipped because an earlier row had the same Item Code. */
  readonly duplicates: number
}

export interface BadRow {
  /** 1-based line number in the file. */
  readonly line: number
  readonly message: string
}

export type ParseItemListResult =
  | { ok: true; items: ItemListEntry[]; summary: ItemListSummary; badRows: BadRow[] }
  | { ok: false; message: string; summary: ItemListSummary; badRows: BadRow[] }

/**
 * Parses `item_phq.txt` text. Each row is checked (at least 15 columns, a valid Item Code, a drug
 * name and a base unit); a bad row is skipped and counted, and so is a repeated Item Code (the first
 * row wins). The whole file is refused when it is empty, when most rows have too few columns (the
 * wrong file), when no row is valid, or when more than 1% of rows are bad.
 */
export function parseItemList(text: string): ParseItemListResult {
  const items: ItemListEntry[] = []
  const seen = new Set<string>()
  const badRows: BadRow[] = []
  let rows = 0
  let badRowCount = 0
  let shortRows = 0
  let duplicates = 0
  let liquids = 0

  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim() === '') continue
    rows++
    const cells = line.split('\t')
    const entry = checkRow(cells)
    if (typeof entry === 'string') {
      if (cells.length < ITEM_LIST_MIN_COLUMNS) shortRows++
      badRowCount++
      if (badRows.length < MAX_LISTED_BAD_ROWS) badRows.push({ line: index + 1, message: `Line ${index + 1}: ${entry}` })
      continue
    }
    if (seen.has(entry.itemCode)) {
      duplicates++
      continue
    }
    seen.add(entry.itemCode)
    items.push(entry)
    if (isLiquid(entry)) liquids++
  }

  const summary: ItemListSummary = { rows, items: items.length, liquids, badRows: badRowCount, duplicates }
  const refuse = (message: string): ParseItemListResult => ({ ok: false, message, summary, badRows })

  if (rows === 0) return refuse('The file is empty.')
  if (shortRows > rows / 2) {
    return refuse(
      `This does not look like an Item List (item_phq.txt): most rows have fewer than ${ITEM_LIST_MIN_COLUMNS} tab-separated columns.`
    )
  }
  if (items.length === 0) return refuse('The file has no valid Item List rows.')
  if (badRowCount > rows * MAX_BAD_ROW_SHARE) {
    return refuse(`${badRowCount} of ${rows} rows are not valid Item List rows (more than ${MAX_BAD_ROW_SHARE * 100}%).`)
  }
  return { ok: true, items, summary, badRows }
}

/** A valid row's item, or why the row is bad. */
function checkRow(cells: readonly string[]): ItemListEntry | string {
  if (cells.length < ITEM_LIST_MIN_COLUMNS) {
    return `${cells.length} column${cells.length === 1 ? '' : 's'}; an Item List row has at least ${ITEM_LIST_MIN_COLUMNS}.`
  }
  // Taken exactly as written: a space is one of the 40 Item Code characters, so trimming could change a code.
  const encoded = encodeInternalGtin(cells[ITEM_LIST_COLUMNS.itemCode], 0)
  if (!encoded.ok) return encoded.message
  const name = cells[ITEM_LIST_COLUMNS.name].trim()
  if (name === '') return 'no drug name.'
  const baseUnit = upperCaseAscii(cells[ITEM_LIST_COLUMNS.baseUnit].trim())
  if (baseUnit === '') return 'no base unit.'
  return { itemCode: encoded.itemCode, name, baseUnit }
}

/** True for a liquid (base unit `ML`), the only kind of item with a Pack Volume. */
export function isLiquid(item: Pick<ItemListEntry, 'baseUnit'>): boolean {
  return item.baseUnit === LIQUID_BASE_UNIT
}

/** Item Code → item, for lookups. */
export type ItemIndex = ReadonlyMap<string, ItemListEntry>

export function indexItems(items: Iterable<ItemListEntry>): ItemIndex {
  const index = new Map<string, ItemListEntry>()
  for (const item of items) if (!index.has(item.itemCode)) index.set(item.itemCode, item)
  return index
}

/** The listed item for an Item Code (a–z upper-cased first, as the label core does), or null. */
export function lookupItem(index: ItemIndex, itemCode: string): ItemListEntry | null {
  return index.get(upperCaseAscii(itemCode)) ?? null
}

/**
 * The Item List rules for a label: its Item Code must be listed (`item` is the lookup result, null
 * when not listed); an item that is not a liquid has Pack Volume digit 0; a liquid has 0–5 (0 = Other).
 */
export function itemListProblems(
  item: ItemListEntry | null,
  label: { readonly itemCode: string; readonly packVolumeDigit: number }
): FieldMessage[] {
  if (item === null) return [{ field: 'itemCode', message: `${label.itemCode} is not in the Item List.` }]
  const digit = label.packVolumeDigit
  if (!isLiquid(item)) {
    return digit === 0
      ? []
      : [{ field: 'packVolume', message: `${item.itemCode} is not a liquid (base unit ${item.baseUnit}), so it has no Pack Volume.` }]
  }
  return PACK_VOLUMES.some((entry) => entry.digit === digit) ? [] : [{ field: 'packVolume', message: PACK_VOLUME_CHOICE_MESSAGE }]
}

export const PACK_VOLUME_CHOICE_MESSAGE = 'Choose a Pack Volume: 30, 60, 120, 240 or 480 mL, or Other.'

/** About the Item List in use: where it came from, and how many items it holds. */
export interface ItemListInfo {
  /** The imported file's name, e.g. `item_phq.txt`. */
  readonly sourceFileName: string
  /** The imported file's last-modified time, ISO 8601: the "file date". */
  readonly sourceModified: string
  /** When it was imported, ISO 8601. */
  readonly importedAt: string
  /** The Windows user who imported it. */
  readonly importedBy: string
  /** The PC it was imported on. */
  readonly pc: string
  readonly items: number
  readonly liquids: number
}

/** The outcome of importing an Item List file (shared by the main process and the screens). */
export type ItemListImportResult =
  | {
      readonly status: 'imported'
      readonly info: ItemListInfo
      readonly summary: ItemListSummary
      readonly badRows: readonly BadRow[]
      /** Something to know although the import succeeded, e.g. the import log could not be written. */
      readonly warning: string | null
    }
  | {
      readonly status: 'refused'
      /** Why, e.g. `3 of 120 rows are not valid Item List rows (more than 1%).` */
      readonly message: string
      /** What the file held, when it could be read. */
      readonly summary: ItemListSummary | null
      readonly badRows: readonly BadRow[]
      readonly warning: string | null
    }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The local calendar date of an ISO 8601 time as `dd Mon yyyy` (e.g. `19 Oct 2026`), in any locale. */
export function formatFileDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return formatShortDate({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() })
}

/** A calendar date (`month` 1–12) as `dd Mon yyyy`, e.g. `19 Oct 2026`, in any locale. */
export function formatShortDate(date: { readonly year: number; readonly month: number; readonly day: number }): string {
  return `${String(date.day).padStart(2, '0')} ${MONTHS[date.month - 1]} ${date.year}`
}

/** e.g. `14,312 items, 942 liquids, file dated 19 Oct 2026`. */
export function describeItemList(info: Pick<ItemListInfo, 'items' | 'liquids' | 'sourceModified'>): string {
  return `${countOf(info.items, 'item')}, ${countOf(info.liquids, 'liquid')}, file dated ${formatFileDate(info.sourceModified)}`
}

/** `1 item`, `14,312 items`: digits grouped with commas whatever the locale. */
export function countOf(count: number, noun: string): string {
  return `${String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${noun}${count === 1 ? '' : 's'}`
}

/** Upper-cases ASCII a–z only: String.prototype.toUpperCase would turn e.g. "ı" into "I". */
function upperCaseAscii(value: string): string {
  return value.replace(/[a-z]/g, (letter) => letter.toUpperCase())
}
