/**
 * The Item List in the data folder: `items.dat`, sealed, shared by every PC. An import reads the HA
 * file `item_phq.txt` (latin1), parses it, and replaces `items.dat` only if the file is accepted, so a
 * refused file never replaces the Item List in use. Every import is written to the import log.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { encodeInternalGtin } from '../core/internalGtin'
import {
  indexItems,
  isLiquid,
  parseItemList,
  type BadRow,
  type ItemIndex,
  type ItemListEntry,
  type ItemListImportResult,
  type ItemListInfo,
  type ItemListSummary
} from '../core/itemList'
import { errorText } from './atomicWrite'
import { importLogWarning, type ImportLogEntry } from './importLog'
import { readSealed, writeSealed } from './sealed'
import { createSharedFile } from './sharedFile'

export const ITEM_LIST_FILE_NAME = 'items.dat'

/** A larger file cannot be an Item List (the HA file is about 3 MB); it is refused unread. */
export const MAX_ITEM_LIST_FILE_BYTES = 64 * 1024 * 1024

/** An item as stored: [Item Code, drug name, base unit]. */
export type ItemListRow = readonly [itemCode: string, name: string, baseUnit: string]

/** What `items.dat` holds. */
export interface StoredItemList {
  readonly sourceFileName: string
  /** The imported file's last-modified time, ISO 8601. */
  readonly sourceModified: string
  /** ISO 8601. */
  readonly importedAt: string
  /** The Windows user who imported it. */
  readonly importedBy: string
  /** The PC it was imported on. */
  readonly pc: string
  readonly items: readonly ItemListRow[]
}

/** An Item List ready to use. */
export interface LoadedItemList {
  readonly info: ItemListInfo
  readonly index: ItemIndex
}

export function itemListPath(dataFolder: string): string {
  return join(dataFolder, ITEM_LIST_FILE_NAME)
}

export type LoadItemListResult =
  | { status: 'ok'; list: LoadedItemList }
  | { status: 'missing' }
  | { status: 'tampered'; message: string }
  | { status: 'unreadable'; message: string }

/** Reads `items.dat`: the Item List, or why there is none to use. */
export async function loadItemList(dataFolder: string): Promise<LoadItemListResult> {
  const read = await readSealed(itemListPath(dataFolder))
  switch (read.status) {
    case 'missing':
      return read
    case 'tampered':
      return { status: 'tampered', message: `The Item List (${ITEM_LIST_FILE_NAME}) was changed outside the app.` }
    case 'unreadable':
      return { status: 'unreadable', message: `The Item List could not be used: ${read.message}` }
    case 'ok': {
      const stored = asStoredItemList(read.value)
      if (stored) return { status: 'ok', list: loadedFrom(stored) }
      return { status: 'unreadable', message: `The Item List (${ITEM_LIST_FILE_NAME}) is not a valid Item List.` }
    }
  }
}

export interface ItemListImportContext {
  readonly dataFolder: string
  /** Where this PC's import log goes. */
  readonly logFolder: string
  readonly pcName: string
  readonly windowsUser: string
  now(): Date
}

/**
 * Imports `sourcePath` (an `item_phq.txt` staff chose) as the Item List and logs the import. On
 * success `items.dat` is replaced and the new list returned; otherwise nothing changes.
 */
export async function importItemListFile(
  sourcePath: string,
  context: ItemListImportContext
): Promise<{ result: ItemListImportResult; list: LoadedItemList | null }> {
  const at = context.now()

  /** Writes the import log line; a log that cannot be written becomes the result's warning. */
  async function logged(result: ItemListImportResult, line: Pick<ImportLogEntry, 'rowsImported' | 'badRows' | 'result'>): Promise<ItemListImportResult> {
    const warning = await importLogWarning(context.logFolder, { at, windowsUser: context.windowsUser, pcName: context.pcName, kind: 'Item List', file: sourcePath, ...line })
    return warning ? { ...result, warning } : result
  }

  /** Nothing imported: `Refused` when the file is not accepted, `Failed` when it could not be read or saved. */
  async function notImported(
    outcome: 'Refused' | 'Failed',
    message: string,
    parsed?: { summary: ItemListSummary; badRows: readonly BadRow[] }
  ): Promise<{ result: ItemListImportResult; list: null }> {
    const result = await logged(
      { status: 'refused', message, summary: parsed?.summary ?? null, badRows: parsed?.badRows ?? [], warning: null },
      { rowsImported: 0, badRows: parsed?.summary.badRows ?? 0, result: `${outcome}: ${message}` }
    )
    return { result, list: null }
  }

  let modified: Date
  let text: string
  try {
    const stats = await stat(sourcePath)
    if (stats.size > MAX_ITEM_LIST_FILE_BYTES) {
      return notImported('Refused', `The file is too large to be an Item List (${Math.ceil(stats.size / (1024 * 1024))} MB).`)
    }
    modified = stats.mtime
    text = await readFile(sourcePath, 'latin1')
  } catch (error) {
    return notImported('Failed', `The file could not be read: ${errorText(error)}`)
  }

  const parsed = parseItemList(text)
  if (!parsed.ok) return notImported('Refused', parsed.message, parsed)

  const stored: StoredItemList = {
    sourceFileName: basename(sourcePath),
    sourceModified: modified.toISOString(),
    importedAt: at.toISOString(),
    importedBy: context.windowsUser,
    pc: context.pcName,
    items: parsed.items.map((item) => [item.itemCode, item.name, item.baseUnit] as const)
  }
  try {
    await writeSealed(itemListPath(context.dataFolder), stored)
  } catch (error) {
    return notImported('Failed', `The Item List could not be saved: ${errorText(error)}`, parsed)
  }

  const list = loadedFrom(stored, parsed.items)
  const result = await logged(
    { status: 'imported', info: list.info, summary: parsed.summary, badRows: parsed.badRows, warning: null },
    { rowsImported: parsed.summary.items, badRows: parsed.summary.badRows, result: 'Imported' }
  )
  return { result, list }
}

/** The Item List in use on this PC. */
export interface ItemListSource {
  /** Reads `items.dat` (at startup): the Item List in use is what it holds, or none if it cannot be used. */
  load(): Promise<LoadItemListResult>
  /** The Item List in use, first reloaded if another PC has replaced `items.dat` since; null if none. */
  current(): Promise<LoadedItemList | null>
  /** Imports a file; an accepted file becomes the Item List in use. */
  importFile(sourcePath: string, context: Omit<ItemListImportContext, 'dataFolder'>): Promise<ItemListImportResult>
}

/**
 * Keeps the Item List in memory, noticing when another PC sharing the data folder imports a newer
 * one. A damaged or changed `items.dat` found later is ignored until the next start: the list in use
 * was verified when it was read.
 */
export function createItemListSource(dataFolder: string): ItemListSource {
  const file = createSharedFile(
    itemListPath(dataFolder),
    () => loadItemList(dataFolder),
    (loaded) => (loaded.status === 'ok' ? loaded.list : null)
  )
  return {
    load: file.load,
    current: file.current,
    async importFile(sourcePath, context) {
      const { result, list } = await importItemListFile(sourcePath, { ...context, dataFolder })
      if (list) await file.replaced(list)
      return result
    }
  }
}

function loadedFrom(stored: StoredItemList, entries?: readonly ItemListEntry[]): LoadedItemList {
  const items = entries ?? stored.items.map(([itemCode, name, baseUnit]) => ({ itemCode, name, baseUnit }))
  const index = indexItems(items)
  let liquids = 0
  for (const item of index.values()) if (isLiquid(item)) liquids++
  const { sourceFileName, sourceModified, importedAt, importedBy, pc } = stored
  return { info: { sourceFileName, sourceModified, importedAt, importedBy, pc, items: index.size, liquids }, index }
}

/** The stored Item List, if `value` is one (every row three strings with a valid Item Code). */
function asStoredItemList(value: unknown): StoredItemList | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const strings = ['sourceFileName', 'sourceModified', 'importedAt', 'importedBy', 'pc'] as const
  if (!strings.every((key) => typeof record[key] === 'string')) return null
  const { items } = record
  if (!Array.isArray(items)) return null
  const valid = items.every((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 3 || !row.every((cell) => typeof cell === 'string')) return false
    const encoded = encodeInternalGtin(row[0], 0)
    return encoded.ok && encoded.itemCode === row[0]
  })
  return valid ? (record as unknown as StoredItemList) : null
}
