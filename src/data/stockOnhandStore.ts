/**
 * The Stock Onhand in the data folder: `stock.dat`, sealed, shared by every PC. An import reads the
 * Oracle report "HA: INV Stock onhand with lot details" (a `.ps`, `.txt` or `.csv` text file, UTF-8
 * or Windows-1252), parses it, and replaces `stock.dat` only if the report is accepted, so a refused
 * file never replaces the Stock Onhand in use. Every import is written to the import log.
 *
 * Any accepted report replaces the one in use, whatever its Report Date; the Report Date rule
 * (usable for picking only on that day) is applied when Lots are picked.
 */
import { parseIsoDate } from '../core/expiry'
import { encodeInternalGtin } from '../core/internalGtin'
import type { BadRow, ItemIndex } from '../core/itemList'
import {
  countItemsNotInItemList,
  indexStockLots,
  parseStockOnhand,
  type StockLot,
  type StockLotIndex,
  type StockOnhandHeader,
  type StockOnhandImportResult,
  type StockOnhandInfo,
  type StockOnhandSummary
} from '../core/stockOnhand'
import { errorText } from './atomicWrite'
import { platform } from './platform'
import { importLogWarning, type ImportLogEntry } from './importLog'
import { decodeReportText } from './reportText'
import { readSealed, writeSealed } from './sealed'
import { createSharedFile } from './sharedFile'

export const STOCK_ONHAND_FILE_NAME = 'stock.dat'

/** A larger file cannot be a Stock Onhand report (a few MB); it is refused unread. */
export const MAX_STOCK_ONHAND_FILE_BYTES = 64 * 1024 * 1024

/** A Lot as stored: [Item Code, Lot, Expiry YYMMDD or null, UOM, quantity]. */
export type StockLotRow = readonly [itemCode: string, lot: string, expiry: string | null, uom: string, quantity: number]

/** What `stock.dat` holds. */
export interface StoredStockOnhand extends StockOnhandHeader {
  readonly sourceFileName: string
  /** The imported file's last-modified time, ISO 8601. */
  readonly sourceModified: string
  /** ISO 8601. */
  readonly importedAt: string
  /** The Windows user who imported it. */
  readonly importedBy: string
  /** The PC it was imported on. */
  readonly pc: string
  readonly lots: readonly StockLotRow[]
}

/** A Stock Onhand ready to use. */
export interface LoadedStockOnhand {
  readonly info: StockOnhandInfo
  readonly index: StockLotIndex
}

export function stockOnhandPath(dataFolder: string): string {
  return platform().path.join(dataFolder, STOCK_ONHAND_FILE_NAME)
}

export type LoadStockOnhandResult =
  | { status: 'ok'; stock: LoadedStockOnhand }
  | { status: 'missing' }
  | { status: 'tampered'; message: string }
  | { status: 'unreadable'; message: string }

/** Reads `stock.dat`: the Stock Onhand, or why there is none to use. */
export async function loadStockOnhand(dataFolder: string): Promise<LoadStockOnhandResult> {
  const read = await readSealed(stockOnhandPath(dataFolder))
  switch (read.status) {
    case 'missing':
      return read
    case 'tampered':
      return { status: 'tampered', message: `The Stock Onhand (${STOCK_ONHAND_FILE_NAME}) was changed outside the app.` }
    case 'unreadable':
      return { status: 'unreadable', message: `The Stock Onhand could not be used: ${read.message}` }
    case 'ok': {
      const stored = asStoredStockOnhand(read.value)
      if (stored) return { status: 'ok', stock: loadedFrom(stored) }
      return { status: 'unreadable', message: `The Stock Onhand (${STOCK_ONHAND_FILE_NAME}) is not a valid Stock Onhand.` }
    }
  }
}

export interface StockOnhandImportContext {
  readonly dataFolder: string
  /** Where this PC's import log goes. */
  readonly logFolder: string
  readonly pcName: string
  readonly windowsUser: string
  now(): Date
  /** The Item List in use, to count the report's Item Codes it does not list; null if none. */
  readonly itemIndex: ItemIndex | null
}

/**
 * Imports `sourcePath` (a report staff chose) as the Stock Onhand and logs the import. On success
 * `stock.dat` is replaced and the new Stock Onhand returned; otherwise nothing changes.
 */
export async function importStockOnhandFile(
  sourcePath: string,
  context: StockOnhandImportContext
): Promise<{ result: StockOnhandImportResult; stock: LoadedStockOnhand | null }> {
  const at = context.now()
  const log = (line: Pick<ImportLogEntry, 'rowsImported' | 'badRows' | 'result'>): Promise<string | null> =>
    importLogWarning(context.logFolder, { at, windowsUser: context.windowsUser, pcName: context.pcName, kind: 'Stock Onhand', file: sourcePath, ...line })

  /** Nothing imported: `Refused` when the report is not accepted, `Failed` when it could not be read or saved. */
  async function notImported(
    outcome: 'Refused' | 'Failed',
    message: string,
    parsed?: { summary: StockOnhandSummary | null; badRows: readonly BadRow[] }
  ): Promise<{ result: StockOnhandImportResult; stock: null }> {
    const summary = parsed?.summary ?? null
    const warning = await log({ rowsImported: 0, badRows: summary?.badRows ?? 0, result: `${outcome}: ${message}` })
    return { result: { status: 'refused', message, summary, badRows: parsed?.badRows ?? [], warning }, stock: null }
  }

  let modified: Date
  let text: string
  try {
    const stats = await platform().fs.stat(sourcePath)
    if (stats.size > MAX_STOCK_ONHAND_FILE_BYTES) {
      return notImported('Refused', `The file is too large to be a Stock Onhand report (${Math.ceil(stats.size / (1024 * 1024))} MB).`)
    }
    modified = new Date(stats.mtimeMs)
    text = decodeReportText(await platform().fs.readFile(sourcePath))
  } catch (error) {
    return notImported('Failed', `The file could not be read: ${errorText(error)}`)
  }

  const parsed = parseStockOnhand(text)
  if (!parsed.ok) return notImported('Refused', parsed.message, parsed)

  const stored: StoredStockOnhand = {
    sourceFileName: platform().path.basename(sourcePath),
    sourceModified: modified.toISOString(),
    importedAt: at.toISOString(),
    importedBy: context.windowsUser,
    pc: context.pcName,
    ...parsed.header,
    lots: parsed.lots.map((lot) => [lot.itemCode, lot.lot, lot.expiry, lot.uom, lot.quantity] as const)
  }
  try {
    await writeSealed(stockOnhandPath(context.dataFolder), stored)
  } catch (error) {
    return notImported('Failed', `The Stock Onhand could not be saved: ${errorText(error)}`, parsed)
  }

  const stock = loadedFrom(stored)
  const warning = await log({ rowsImported: parsed.summary.lots, badRows: parsed.summary.badRows, result: 'Imported' })
  return {
    result: {
      status: 'imported',
      info: stock.info,
      summary: parsed.summary,
      badRows: parsed.badRows,
      notInItemList: context.itemIndex ? countItemsNotInItemList(stock.index, context.itemIndex) : null,
      warning
    },
    stock
  }
}

/** The Stock Onhand in use on this PC. */
export interface StockOnhandSource {
  /** Reads `stock.dat` (at startup): the Stock Onhand in use is what it holds, or none if it cannot be used. */
  load(): Promise<LoadStockOnhandResult>
  /** The Stock Onhand in use, first reloaded if another PC has replaced `stock.dat` since; null if none. */
  current(): Promise<LoadedStockOnhand | null>
  /** Imports a report; an accepted report becomes the Stock Onhand in use. */
  importFile(sourcePath: string, context: Omit<StockOnhandImportContext, 'dataFolder'>): Promise<StockOnhandImportResult>
}

/** Keeps the Stock Onhand in memory, noticing when another PC sharing the data folder imports a newer one. */
export function createStockOnhandSource(dataFolder: string): StockOnhandSource {
  const file = createSharedFile(
    stockOnhandPath(dataFolder),
    () => loadStockOnhand(dataFolder),
    (loaded) => (loaded.status === 'ok' ? loaded.stock : null)
  )
  return {
    load: file.load,
    current: file.current,
    async importFile(sourcePath, context) {
      const { result, stock } = await importStockOnhandFile(sourcePath, { ...context, dataFolder })
      if (stock) await file.replaced(stock)
      return result
    }
  }
}

function loadedFrom(stored: StoredStockOnhand): LoadedStockOnhand {
  const lots: StockLot[] = stored.lots.map(([itemCode, lot, expiry, uom, quantity]) => ({ itemCode, lot, expiry, uom, quantity }))
  const index = indexStockLots(lots)
  const { sourceFileName, sourceModified, importedAt, importedBy, pc, reportDate, reportTime, organizationCode, subinventoryCode } = stored
  return {
    info: {
      sourceFileName,
      sourceModified,
      importedAt,
      importedBy,
      pc,
      reportDate,
      reportTime,
      organizationCode,
      subinventoryCode,
      items: index.size,
      lots: lots.length
    },
    index
  }
}

/** The stored Stock Onhand, if `value` is one (a real Report Date; every Lot well formed). */
function asStoredStockOnhand(value: unknown): StoredStockOnhand | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const strings = ['sourceFileName', 'sourceModified', 'importedAt', 'importedBy', 'pc', 'reportDate', 'organizationCode', 'subinventoryCode'] as const
  if (!strings.every((key) => typeof record[key] === 'string')) return null
  if (!parseIsoDate(record.reportDate as string)) return null
  if (record.reportTime !== null && typeof record.reportTime !== 'string') return null
  const { lots } = record
  if (!Array.isArray(lots)) return null
  const valid = lots.every((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 5) return false
    const [itemCode, lot, expiry, uom, quantity] = row as unknown[]
    if (typeof itemCode !== 'string' || typeof lot !== 'string' || typeof uom !== 'string') return false
    if (expiry !== null && (typeof expiry !== 'string' || !/^[0-9]{6}$/.test(expiry))) return false
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return false
    const encoded = encodeInternalGtin(itemCode, 0)
    return encoded.ok && encoded.itemCode === itemCode
  })
  return valid ? (record as unknown as StoredStockOnhand) : null
}
