/**
 * Stock Onhand: the daily Oracle report "HA: INV Stock onhand with lot details" (a `.ps` file that is
 * plain text) imported into the app, the source of the Lots staff can pick. It is valid only on its
 * Report Date. This module parses the report's text, indexes its Lots by Item Code, and holds the
 * Report Date rule.
 *
 * Layout: a header block of `Key: value` lines up to the first blank line (`Report Date:
 * dd/mm/yyyy hh:mm:ss` is required), then CSV with a header row:
 *
 *   Cluster,Org Code,Subinventory,Item Code,Item Description,Lot Number,Expiry Date,UOM,Onhand Quantity,Unit Cost,Onhand Value
 *   DKW,NL0,NL0-S-MAIN,"=""ACAR01""",ACARBOSE TABLET 100MG,"=""BXK9T31""",01/01/2028,TAB,1000,1,1000
 *
 * Item Code and Lot Number are Excel text `="…"`. A description may hold an unquoted comma. The
 * caller decodes the file (UTF-8, else Windows-1252).
 *
 * Pure: no Node, DOM or Electron, never reads the clock.
 */

import { parseIsoDate } from './expiry'
import { encodeInternalGtin } from './internalGtin'
import { countOf, formatFileDate, formatShortDate, lookupItem, MAX_BAD_ROW_SHARE, MAX_LISTED_BAD_ROWS, type BadRow, type ItemIndex } from './itemList'

export const STOCK_ONHAND_REPORT_NAME = 'HA: INV Stock onhand with lot details'

/** The report's columns in its standard layout. */
export const STANDARD_COLUMNS: readonly string[] = [
  'Cluster',
  'Org Code',
  'Subinventory',
  'Item Code',
  'Item Description',
  'Lot Number',
  'Expiry Date',
  'UOM',
  'Onhand Quantity',
  'Unit Cost',
  'Onhand Value'
]

/** In the standard layout, the fixed columns before and after Item Description. */
const STANDARD_LEADING_COLUMNS = 4
const STANDARD_TRAILING_COLUMNS = 6

/** The columns a report must have, found by name. */
const REQUIRED_COLUMNS = {
  itemCode: 'Item Code',
  description: 'Item Description',
  lot: 'Lot Number',
  expiry: 'Expiry Date',
  uom: 'UOM',
  quantity: 'Onhand Quantity'
} as const

type RequiredColumn = keyof typeof REQUIRED_COLUMNS

/** From the report's header block. */
export interface StockOnhandHeader {
  /** The local calendar date it is valid for, `yyyy-mm-dd`. */
  readonly reportDate: string
  /** `hh:mm:ss`; null when the Report Date has no time. */
  readonly reportTime: string | null
  /** e.g. `NL0`; empty if the header has none. */
  readonly organizationCode: string
  /** e.g. `NL0-S-MAIN`; empty if the header has none. */
  readonly subinventoryCode: string
}

/** One Lot of an item held in stock. */
export interface StockLot {
  /** Upper-case, exactly 6 characters from the 40 of ADR-0002. */
  readonly itemCode: string
  /** As recorded, without surrounding spaces; the Lot rules judge it when it is picked. */
  readonly lot: string
  /** AI (17) `YYMMDD`, from the Expiry Date as written; null when the report gives none. */
  readonly expiry: string | null
  /** e.g. `TAB`, as recorded. */
  readonly uom: string
  /** Onhand Quantity, summed over rows with the same Item Code and Lot. */
  readonly quantity: number
}

/** A Lot as read from the report, with the description of its first row. */
export interface StockOnhandRow extends StockLot {
  readonly description: string
}

/** What a report held. */
export interface StockOnhandSummary {
  /** Non-blank lines after the header row. */
  readonly rows: number
  /** Item Codes with at least one Lot. */
  readonly items: number
  /** Distinct Item Code + Lot. */
  readonly lots: number
  readonly badRows: number
  /** Rows with no Lot Number (items not under lot control): skipped, not bad. */
  readonly withoutLot: number
  /** Rows added to an earlier row with the same Item Code and Lot. */
  readonly merged: number
}

export type ParseStockOnhandResult =
  | { ok: true; header: StockOnhandHeader; lots: StockOnhandRow[]; summary: StockOnhandSummary; badRows: BadRow[] }
  | { ok: false; message: string; header: StockOnhandHeader | null; summary: StockOnhandSummary | null; badRows: BadRow[] }

/**
 * Parses the report's text. The header block must give a Report Date and the header row must name
 * every required column. Each row is checked (a valid Item Code, a real Expiry Date, a numeric
 * quantity); a bad row is skipped and counted. Rows with the same Item Code and Lot are merged by
 * summing their quantity. The report is refused when it has no row with a Lot, or more than 1% of
 * its rows are bad.
 */
export function parseStockOnhand(text: string): ParseStockOnhandResult {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/)

  // The header block: `Key: value` lines up to the first blank line.
  const fields = new Map<string, string>()
  let index = 0
  for (; index < lines.length && lines[index].trim() !== ''; index++) {
    const colon = lines[index].indexOf(':')
    if (colon < 0) continue
    const key = normaliseName(lines[index].slice(0, colon))
    if (!fields.has(key)) fields.set(key, lines[index].slice(colon + 1).trim())
  }
  const refuse = (message: string, header: StockOnhandHeader | null = null): ParseStockOnhandResult => ({
    ok: false,
    message,
    header,
    summary: null,
    badRows: []
  })

  const reportDateText = fields.get('report date')
  if (reportDateText === undefined) {
    return refuse(`The report has no "Report Date:" line, so the day it is valid for is unknown. Use the report "${STOCK_ONHAND_REPORT_NAME}".`)
  }
  const reportDate = parseReportDate(reportDateText)
  if (!reportDate) return refuse(`The Report Date "${reportDateText}" is not a date and time as dd/mm/yyyy hh:mm:ss.`)
  const header: StockOnhandHeader = {
    ...reportDate,
    organizationCode: fields.get('organization code') ?? '',
    subinventoryCode: fields.get('subinventory code') ?? ''
  }

  // The header row: the first non-blank line after the header block.
  while (index < lines.length && lines[index].trim() === '') index++
  if (index >= lines.length) return refuse('The report has no column header row after its header block.', header)
  const columnNames = (splitCsvLine(lines[index]) ?? []).map(normaliseName)
  const standard = columnNames.length === STANDARD_COLUMNS.length && STANDARD_COLUMNS.every((name, i) => normaliseName(name) === columnNames[i])
  const columns = {} as Record<RequiredColumn, number>
  const missing: string[] = []
  for (const [key, name] of Object.entries(REQUIRED_COLUMNS) as [RequiredColumn, string][]) {
    columns[key] = columnNames.indexOf(normaliseName(name))
    if (columns[key] < 0) missing.push(`"${name}"`)
  }
  if (missing.length > 0) {
    const names = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}`
    return refuse(
      `The report has no ${names} column. Its header row needs Item Code, Item Description, Lot Number, Expiry Date, UOM and Onhand Quantity.`,
      header
    )
  }

  // The rows.
  const lots: StockOnhandRow[] = []
  const byKey = new Map<string, number>()
  const badRows: BadRow[] = []
  let rows = 0
  let badRowCount = 0
  let withoutLot = 0
  let merged = 0
  const bad = (line: number, message: string): void => {
    badRowCount++
    if (badRows.length < MAX_LISTED_BAD_ROWS) badRows.push({ line, message: `Line ${line}: ${message}` })
  }

  for (index++; index < lines.length; index++) {
    if (lines[index].trim() === '') continue
    rows++
    const line = index + 1
    const cells = readRow(lines[index], columnNames.length, standard)
    if (typeof cells === 'string') {
      bad(line, cells)
      continue
    }
    const checked = checkRow((key) => cells[columns[key]])
    if (typeof checked === 'string') {
      bad(line, checked)
      continue
    }
    if (checked === null) {
      withoutLot++
      continue
    }
    const key = `${checked.itemCode}\n${checked.lot}`
    const earlier = byKey.get(key)
    if (earlier === undefined) {
      byKey.set(key, lots.length)
      lots.push(checked)
    } else if (lots[earlier].expiry !== checked.expiry) {
      bad(line, `Lot ${checked.lot} of ${checked.itemCode} is listed again with another Expiry Date (${cells[columns.expiry].trim()}).`)
    } else {
      lots[earlier] = { ...lots[earlier], quantity: addQuantities(lots[earlier].quantity, checked.quantity) }
      merged++
    }
  }

  const summary: StockOnhandSummary = {
    rows,
    items: new Set(lots.map((lot) => lot.itemCode)).size,
    lots: lots.length,
    badRows: badRowCount,
    withoutLot,
    merged
  }
  const refuseRows = (message: string): ParseStockOnhandResult => ({ ok: false, message, header, summary, badRows })
  if (rows === 0) return refuseRows('The report has no Stock Onhand rows.')
  if (badRowCount > rows * MAX_BAD_ROW_SHARE) {
    return refuseRows(`${badRowCount} of ${rows} rows are not valid Stock Onhand rows (more than ${MAX_BAD_ROW_SHARE * 100}%).`)
  }
  if (lots.length === 0) return refuseRows('The report has no Stock Onhand rows with a Lot.')
  return { ok: true, header, lots, summary, badRows }
}

/**
 * A row's fields, unquoted and with `="…"` unwrapped, or why it cannot be read. A row of the
 * standard layout with extra fields has an unquoted comma in its description: its 4 leading and 6
 * trailing fields are the fixed columns and the rest is the description.
 */
function readRow(line: string, columnCount: number, standard: boolean): string[] | string {
  const split = splitCsvLine(line)
  if (split === null) return 'a quoted field has no closing quote.'
  let cells = split
  if (cells.length > columnCount && standard) {
    cells = [
      ...cells.slice(0, STANDARD_LEADING_COLUMNS),
      cells.slice(STANDARD_LEADING_COLUMNS, cells.length - STANDARD_TRAILING_COLUMNS).join(','),
      ...cells.slice(cells.length - STANDARD_TRAILING_COLUMNS)
    ]
  }
  if (cells.length !== columnCount) return `${cells.length} field${cells.length === 1 ? '' : 's'}; the header row has ${columnCount}.`
  return cells.map(unwrapExcelText)
}

/** A row's Lot, null for a row with no Lot, or why the row is bad. */
function checkRow(cell: (column: RequiredColumn) => string): StockOnhandRow | null | string {
  // Taken exactly as written: a space is one of the 40 Item Code characters, so trimming could change a code.
  const encoded = encodeInternalGtin(cell('itemCode'), 0)
  if (!encoded.ok) return encoded.message
  const lot = cell('lot').trim()
  if (lot === '') return null

  const expiryText = cell('expiry').trim()
  let expiry: string | null = null
  if (expiryText !== '') {
    const match = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/.exec(expiryText)
    const date = match ? parseIsoDate(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`) : null
    if (!date) return `Expiry Date "${expiryText}" is not a date as dd/mm/yyyy.`
    if (date.year < 2000 || date.year > 2099) return `Expiry Date "${expiryText}" is outside 2000–2099.`
    expiry = pad2(date.year % 100) + pad2(date.month) + pad2(date.day)
  }

  const quantity = parseQuantity(cell('quantity'))
  if (quantity === null) return `Onhand Quantity "${cell('quantity').trim()}" is not a number.`

  return { itemCode: encoded.itemCode, description: cell('description').trim(), lot, expiry, uom: cell('uom').trim(), quantity }
}

/**
 * Splits one CSV line into fields (RFC 4180 quoting: `"a,b"`, `""` for a quote). A quote inside an
 * unquoted field is kept as it is. Null if a quoted field has no closing quote.
 */
export function splitCsvLine(line: string): string[] | null {
  const fields: string[] = []
  let position = 0
  for (;;) {
    let field = ''
    if (line[position] === '"') {
      position++
      for (;;) {
        const quote = line.indexOf('"', position)
        if (quote < 0) return null
        field += line.slice(position, quote)
        position = quote + 1
        if (line[position] !== '"') break
        field += '"'
        position++
      }
    }
    const comma = line.indexOf(',', position)
    const end = comma < 0 ? line.length : comma
    field += line.slice(position, end)
    fields.push(field)
    if (comma < 0) return fields
    position = comma + 1
  }
}

/** `="ACAR01"` (Excel text) → `ACAR01`; any other value unchanged. */
function unwrapExcelText(value: string): string {
  const match = /^="(.*)"$/s.exec(value)
  return match ? match[1].replace(/""/g, '"') : value
}

/** `dd/mm/yyyy[ hh:mm[:ss]]` → local date and time; null if malformed or impossible. */
function parseReportDate(value: string): Pick<StockOnhandHeader, 'reportDate' | 'reportTime'> | null {
  const match = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})(?:\s+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?)?$/.exec(value.trim())
  if (!match) return null
  const [, day, month, year, hours, minutes, seconds = '00'] = match
  const reportDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  if (!parseIsoDate(reportDate)) return null
  if (hours === undefined) return { reportDate, reportTime: null }
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null
  return { reportDate, reportTime: `${hours.padStart(2, '0')}:${minutes}:${seconds}` }
}

/** `1000`, `12.5`, `.5`, `1,250.5`, `-3` → a number; null for anything else. */
function parseQuantity(value: string): number | null {
  const text = value.trim()
  const plain = /^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]*)?$/.test(text) ? text.replace(/,/g, '') : text
  if (!/^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)$/.test(plain)) return null
  const quantity = Number(plain)
  return Number.isFinite(quantity) ? quantity : null
}

/** Sums two quantities without binary floating-point noise (0.1 + 0.2 = 0.3). */
function addQuantities(a: number, b: number): number {
  return Math.round((a + b) * 1e6) / 1e6
}

/** Column and header names compare trimmed, with runs of spaces as one, ignoring case. */
function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Item Code → its Lots, in report order. */
export type StockLotIndex = ReadonlyMap<string, readonly StockLot[]>

export function indexStockLots(lots: Iterable<StockLot>): StockLotIndex {
  const index = new Map<string, StockLot[]>()
  for (const lot of lots) {
    const list = index.get(lot.itemCode)
    if (list) list.push(lot)
    else index.set(lot.itemCode, [lot])
  }
  return index
}

/** The Lots of an Item Code (a–z upper-cased first, as the Item List lookup does); empty if none. */
export function stockLotsFor(index: StockLotIndex, itemCode: string): readonly StockLot[] {
  return index.get(itemCode.replace(/[a-z]/g, (letter) => letter.toUpperCase())) ?? []
}

/** How many of the Stock Onhand's Item Codes are not in the Item List. */
export function countItemsNotInItemList(index: StockLotIndex, items: ItemIndex): number {
  let count = 0
  for (const itemCode of index.keys()) if (lookupItem(items, itemCode) === null) count++
  return count
}

/** About the Stock Onhand in use: where it came from, the day it is valid for, and what it holds. */
export interface StockOnhandInfo extends StockOnhandHeader {
  /** The imported file's name, e.g. `stock_onhand.ps`. */
  readonly sourceFileName: string
  /** The imported file's last-modified time, ISO 8601. */
  readonly sourceModified: string
  /** When it was imported, ISO 8601. */
  readonly importedAt: string
  /** The Windows user who imported it. */
  readonly importedBy: string
  /** The PC it was imported on. */
  readonly pc: string
  readonly items: number
  readonly lots: number
}

/** The outcome of importing a Stock Onhand report (shared by the main process and the screens). */
export type StockOnhandImportResult =
  | {
      readonly status: 'imported'
      readonly info: StockOnhandInfo
      readonly summary: StockOnhandSummary
      readonly badRows: readonly BadRow[]
      /** Item Codes in the report that are not in the Item List in use; null when there is no Item List. */
      readonly notInItemList: number | null
      /** Something to know although the import succeeded, e.g. the import log could not be written. */
      readonly warning: string | null
    }
  | {
      readonly status: 'refused'
      /** Why, e.g. `The report has no "Report Date:" line, …`. */
      readonly message: string
      /** What the report held, when its rows could be read. */
      readonly summary: StockOnhandSummary | null
      readonly badRows: readonly BadRow[]
      readonly warning: string | null
    }

export type StockOnhandValidity = 'none' | 'today' | 'stale'

/**
 * The Report Date rule: a Stock Onhand can be used to pick Lots only on its Report Date (`today` is
 * the local date as `yyyy-mm-dd`).
 */
export function stockOnhandValidity(info: Pick<StockOnhandInfo, 'reportDate'> | null, today: string): StockOnhandValidity {
  if (info === null) return 'none'
  return info.reportDate === today ? 'today' : 'stale'
}

export function isStockOnhandForToday(info: Pick<StockOnhandInfo, 'reportDate'> | null, today: string): boolean {
  return stockOnhandValidity(info, today) === 'today'
}

/** `2026-10-19` → `19 Oct 2026`. */
export function formatReportDate(reportDate: string): string {
  const date = parseIsoDate(reportDate)
  return date ? formatShortDate(date) : 'unknown date'
}

/** Where the stock is held: the Subinventory, else the Organization; empty if the report names neither. */
export function stockOnhandLocation(info: Pick<StockOnhandInfo, 'organizationCode' | 'subinventoryCode'>): string {
  return info.subinventoryCode || info.organizationCode
}

/** For the header: `Stock Onhand: 19 Oct 2026 (NL0-S-MAIN)`, `…: dated 18 Oct 2026 — import today's file` or `…: none`. */
export function stockOnhandStatusText(info: StockOnhandInfo | null, today: string): string {
  switch (stockOnhandValidity(info, today)) {
    case 'none':
      return 'Stock Onhand: none'
    case 'stale':
      return `Stock Onhand: dated ${formatReportDate(info!.reportDate)} — import today's file`
    case 'today': {
      const location = stockOnhandLocation(info!)
      return `Stock Onhand: ${formatReportDate(info!.reportDate)}${location ? ` (${location})` : ''}`
    }
  }
}

/** Why Lots cannot be picked from a Stock Onhand dated another day. */
export function staleStockOnhandMessage(info: Pick<StockOnhandInfo, 'reportDate'>): string {
  return `Stock Onhand is dated ${formatReportDate(info.reportDate)}. Import today's file to pick a Lot.`
}

/** e.g. `1,118 Lots of 104 items, Report Date 19 Oct 2026 16:22:43, NL0-S-MAIN`. */
export function describeStockOnhand(info: StockOnhandInfo): string {
  const location = stockOnhandLocation(info)
  return (
    `${countOf(info.lots, 'Lot')} of ${countOf(info.items, 'item')}, ` +
    `Report Date ${formatReportDate(info.reportDate)}${info.reportTime ? ` ${info.reportTime}` : ''}${location ? `, ${location}` : ''}`
  )
}

/** When it was imported, and by whom: `19 Oct 2026 09:00 by chantm on PHARM-01`. */
export function describeStockOnhandImport(info: Pick<StockOnhandInfo, 'importedAt' | 'importedBy' | 'pc'>): string {
  const at = new Date(info.importedAt)
  const time = Number.isNaN(at.getTime()) ? '' : ` ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  return `${formatFileDate(info.importedAt)}${time} by ${info.importedBy} on ${info.pc}`
}
