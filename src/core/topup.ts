/**
 * The Topup Database and the code content of a Topup Label: the `<drug>` text the workbook
 * `QRCode for Topup.xlsm` built in its column B, which the drug top-up system reads.
 */

import { MAX_BAD_ROW_SHARE, MAX_LISTED_BAD_ROWS, type BadRow } from './itemList'

/** One Item Code's entry in the Topup Database. Empty cells are empty strings. */
export interface TopupEntry {
  readonly itemCode: string
  /** Display Name (MOE). */
  readonly displayName: string
  /** Salt / Special Property (MOE). */
  readonly salt: string
  readonly formCode: string
}

/**
 * The content of a Topup Label's code, byte-identical to the workbook's column B:
 * `<drug S="1"><a>` & display name & `</a><b>` & salt & … & Item Code & `</f>…</drug>`. Nothing is
 * escaped (`&` stays `&`), as the workbook's formula did not.
 */
export function topupContent(entry: TopupEntry): string {
  return (
    `<drug S="1"><a>${entry.displayName}</a><b>${entry.salt}</b><c></c><d>${entry.formCode}</d><e></e>` +
    `<f>${entry.itemCode}</f><G></G><H></H><I></I><J></J></drug>`
  )
}

/** The DataBase sheet's columns the Topup Database is made from, found by name. */
export const TOPUP_COLUMNS = {
  itemCode: 'Item Code',
  displayName: 'Display Name (MOE)',
  salt: 'Salt / Special Property (MOE)',
  formCode: 'Form Code'
} as const

/** The sheet of the workbook the Topup Database is read from. */
export const TOPUP_SHEET_NAME = 'DataBase'

/** A row of the DataBase sheet: its number in the sheet, and its cells from column A. */
export interface TopupSheetRow {
  readonly number: number
  readonly cells: readonly string[]
}

export interface TopupDatabaseSummary {
  /** Rows under the headings. */
  readonly rows: number
  readonly entries: number
  readonly badRows: number
  /** Rows skipped because an earlier row has the same Item Code. */
  readonly duplicates: number
}

export type ParseTopupDatabaseResult =
  | { ok: true; entries: TopupEntry[]; summary: TopupDatabaseSummary; badRows: BadRow[] }
  | { ok: false; message: string; summary: TopupDatabaseSummary; badRows: BadRow[] }

/**
 * Parses the DataBase sheet: its first row holds the headings, the four columns are found by name
 * (ignoring case and surrounding spaces), and every cell is kept exactly as written. A row whose
 * Item Code is not 6 characters is bad, skipped and counted; a repeated Item Code keeps its first
 * row. Refused without one of the columns, with no rows, or with more than 1% bad rows.
 */
export function parseTopupDatabase(rows: readonly TopupSheetRow[]): ParseTopupDatabaseResult {
  const entries: TopupEntry[] = []
  const badRows: BadRow[] = []
  let badRowCount = 0
  let duplicates = 0
  const summary = (): TopupDatabaseSummary => ({ rows: Math.max(0, rows.length - 1), entries: entries.length, badRows: badRowCount, duplicates })
  const refuse = (message: string): ParseTopupDatabaseResult => ({ ok: false, message, summary: summary(), badRows })

  const headings = (rows[0]?.cells ?? []).map((cell) => cell.trim().toLowerCase())
  const columns = Object.fromEntries(Object.entries(TOPUP_COLUMNS).map(([key, name]) => [key, headings.indexOf(name.toLowerCase())])) as Record<
    keyof typeof TOPUP_COLUMNS,
    number
  >
  const missing = (Object.keys(TOPUP_COLUMNS) as (keyof typeof TOPUP_COLUMNS)[]).filter((key) => columns[key] < 0)
  if (missing.length > 0) return refuse(`The ${TOPUP_SHEET_NAME} sheet has no column ${missing.map((key) => `"${TOPUP_COLUMNS[key]}"`).join(', ')}.`)

  const seen = new Set<string>()
  for (const row of rows.slice(1)) {
    const cell = (column: number) => row.cells[column] ?? ''
    const itemCode = cell(columns.itemCode)
    if (itemCode.length !== TOPUP_ITEM_CODE_LENGTH) {
      badRowCount++
      if (badRows.length < MAX_LISTED_BAD_ROWS) badRows.push({ line: row.number, message: `Row ${row.number}: the Item Code "${itemCode}" is not 6 characters.` })
      continue
    }
    if (seen.has(itemCode)) {
      duplicates++
      continue
    }
    seen.add(itemCode)
    entries.push({ itemCode, displayName: cell(columns.displayName), salt: cell(columns.salt), formCode: cell(columns.formCode) })
  }

  const rowCount = rows.length - 1
  if (rowCount <= 0) return refuse(`The ${TOPUP_SHEET_NAME} sheet has no rows.`)
  if (badRowCount > rowCount * MAX_BAD_ROW_SHARE) {
    return refuse(`${badRowCount} of ${rowCount} rows are not valid Topup Database rows (more than ${MAX_BAD_ROW_SHARE * 100}%).`)
  }
  return { ok: true, entries, summary: summary(), badRows }
}

const TOPUP_ITEM_CODE_LENGTH = 6

export type TopupIndex = ReadonlyMap<string, TopupEntry>

/** Indexes entries by Item Code; the first of a repeated Item Code wins. */
export function indexTopup(entries: Iterable<TopupEntry>): TopupIndex {
  const index = new Map<string, TopupEntry>()
  for (const entry of entries) if (!index.has(entry.itemCode)) index.set(entry.itemCode, entry)
  return index
}

/** The entry for an Item Code (a–z upper-cased first, as for the Item List), or null. */
export function lookupTopup(index: TopupIndex, itemCode: string): TopupEntry | null {
  return index.get(itemCode.replace(/[a-z]/g, (letter) => letter.toUpperCase())) ?? null
}

/** About the Topup Database in use. */
export interface TopupDatabaseInfo {
  /** `built-in`: the one in the app; `imported`: `topup.dat`, which overrides it. */
  readonly source: 'built-in' | 'imported'
  /** The workbook's file name, e.g. `QRCode for Topup.xlsm`. */
  readonly sourceFileName: string
  /** The workbook's date, ISO 8601: its last-modified time (for the built-in one, as saved in the workbook). */
  readonly sourceModified: string
  /** When, by whom and on which PC it was imported, ISO 8601; null for the built-in one. */
  readonly importedAt: string | null
  readonly importedBy: string | null
  readonly pc: string | null
  readonly entries: number
}

/** The outcome of importing a Topup Database workbook. */
export type TopupImportResult =
  | {
      readonly status: 'imported'
      readonly info: TopupDatabaseInfo
      readonly summary: TopupDatabaseSummary
      readonly badRows: readonly BadRow[]
      /** Something to know although the import succeeded, e.g. the import log could not be written. */
      readonly warning: string | null
    }
  | {
      readonly status: 'refused'
      readonly message: string
      /** What the sheet held, when it could be read. */
      readonly summary: TopupDatabaseSummary | null
      readonly badRows: readonly BadRow[]
      readonly warning: string | null
    }
