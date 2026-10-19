import { copyFile, readFile, truncate, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lookupItem } from '../core/itemList'
import { linesOf, parseCsvLine } from './csvTesting'
import { IMPORT_LOG_HEADER } from './importLog'
import {
  createItemListSource,
  importItemListFile,
  ITEM_LIST_FILE_NAME,
  itemListPath,
  loadItemList,
  MAX_ITEM_LIST_FILE_BYTES,
  type ItemListImportContext
} from './itemListStore'
import { readSealed, writeSealed } from './sealed'
import { tempFolder } from './testFolder'

const fixture = join(__dirname, '../../test-fixtures/item_phq-synthetic.txt')

/** The file's last-modified time: 9 Oct 2026 22:24:03 local. */
const modified = new Date(2026, 9, 9, 22, 24, 3)
/** 19 Oct 2026 09:15:00 local. */
const now = new Date(2026, 9, 19, 9, 15, 0)

const fixtureInfo = {
  sourceFileName: 'item_phq.txt',
  sourceModified: modified.toISOString(),
  importedAt: now.toISOString(),
  importedBy: 'chantm',
  pc: 'PHARM-01',
  items: 118,
  liquids: 12
}

/** A data folder, and the synthetic fixture copied as `item_phq.txt` with a known modified time. */
async function setup() {
  const dataFolder = await tempFolder()
  const source = join(await tempFolder(), 'item_phq.txt')
  await copyFile(fixture, source)
  await utimes(source, modified, modified)
  const context: ItemListImportContext = { dataFolder, logFolder: join(dataFolder, 'logs'), pcName: 'PHARM-01', windowsUser: 'chantm', now: () => now }
  const logFile = join(dataFolder, 'logs', 'import-log-2026-10-PHARM-01.csv')
  return { dataFolder, source, context, logFile }
}

/** A file in the wrong format: the first lines of a Stock Onhand report. */
async function wrongFile(): Promise<string> {
  const path = join(await tempFolder(), 'stock.ps')
  await writeFile(path, 'Report Date: 19/10/2026 07:00:00\r\nOrganization Code: NLT\r\n\r\nCluster,Org Code,Subinventory,Item Code\r\n', 'latin1')
  return path
}

describe('importItemListFile', () => {
  it('imports the fixture into a sealed items.dat, with its summary and where it came from', async () => {
    const { dataFolder, source, context } = await setup()
    const { result, list } = await importItemListFile(source, context)
    expect(result).toEqual({
      status: 'imported',
      info: fixtureInfo,
      summary: { rows: 120, items: 118, liquids: 12, badRows: 1, duplicates: 1 },
      badRows: [{ line: 41, message: 'Line 41: Item Code must be exactly 6 characters; got 5.' }],
      warning: null
    })
    expect(list?.info).toEqual(fixtureInfo)
    expect(list && lookupItem(list.index, 'para18')).toEqual({ itemCode: 'PARA18', name: 'SYNTHETIC FICTAMOL ORAL SOLUTION 120MG/5ML', baseUnit: 'ML' })

    const bytes = await readFile(itemListPath(dataFolder))
    expect(itemListPath(dataFolder)).toBe(join(dataFolder, ITEM_LIST_FILE_NAME))
    expect(ITEM_LIST_FILE_NAME).toBe('items.dat')
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('TDCP')
    expect(bytes.toString('latin1')).not.toContain('FICTAMOL')
  })

  it('stores the file details and each item as [Item Code, drug name, base unit]', async () => {
    const { dataFolder, source, context } = await setup()
    await importItemListFile(source, context)
    const stored = await readSealed(itemListPath(dataFolder))
    if (stored.status !== 'ok') throw new Error(stored.status)
    const { items, ...details } = stored.value as { items: unknown[] }
    expect(details).toEqual({
      sourceFileName: 'item_phq.txt',
      sourceModified: modified.toISOString(),
      importedAt: now.toISOString(),
      importedBy: 'chantm',
      pc: 'PHARM-01'
    })
    expect(items).toHaveLength(118)
    expect(items[0]).toEqual(['PARA01', 'SYNTHETIC FICTAMOL TABLET 500MG', 'TAB'])
    expect(items).toContainEqual(['AIR 01', 'SYNTHETIC TEST GAS CYLINDER D SIZE', 'CYN'])
  })

  it('refuses a malformed file and keeps the previous Item List', async () => {
    const { dataFolder, source, context } = await setup()
    await importItemListFile(source, context)
    const before = await readFile(itemListPath(dataFolder))

    const { result, list } = await importItemListFile(await wrongFile(), context)
    expect(result).toEqual({
      status: 'refused',
      message: 'This does not look like an Item List (item_phq.txt): most rows have fewer than 15 tab-separated columns.',
      summary: { rows: 3, items: 0, liquids: 0, badRows: 3, duplicates: 0 },
      badRows: expect.any(Array),
      warning: null
    })
    expect(list).toBeNull()
    expect(await readFile(itemListPath(dataFolder))).toEqual(before)
    const loaded = await loadItemList(dataFolder)
    expect(loaded.status === 'ok' && loaded.list.info).toEqual(fixtureInfo)
  })

  it('refuses a file with more than 1% bad rows, keeping the previous Item List', async () => {
    const { dataFolder, source, context } = await setup()
    await importItemListFile(source, context)
    const before = await readFile(itemListPath(dataFolder))
    const worse = join(await tempFolder(), 'item_phq.txt')
    const badRow = ['ZQ00', 'ANOTHER MISTYPED CODE', ...Array.from({ length: 46 }, () => '')].join('\t')
    await writeFile(worse, Buffer.concat([await readFile(fixture), Buffer.from(badRow + '\n', 'latin1')]))

    const { result } = await importItemListFile(worse, context)
    expect(result).toMatchObject({ status: 'refused', message: '2 of 121 rows are not valid Item List rows (more than 1%).' })
    expect(await readFile(itemListPath(dataFolder))).toEqual(before)
  })

  it('creates no items.dat when the first import is refused', async () => {
    const { dataFolder, context } = await setup()
    const { result } = await importItemListFile(await wrongFile(), context)
    expect(result.status).toBe('refused')
    expect(await loadItemList(dataFolder)).toEqual({ status: 'missing' })
  })

  it('refuses a file it cannot read', async () => {
    const { dataFolder, context } = await setup()
    const { result } = await importItemListFile(join(dataFolder, 'no-such-file.txt'), context)
    expect(result).toMatchObject({ status: 'refused', summary: null, badRows: [] })
    expect(result.status === 'refused' && result.message).toMatch(/^The file could not be read: .*ENOENT/)
  })

  it('refuses a file too large to be an Item List without reading it', async () => {
    const { context } = await setup()
    const big = join(await tempFolder(), 'big.txt')
    await writeFile(big, '')
    await truncate(big, MAX_ITEM_LIST_FILE_BYTES + 1)
    const { result } = await importItemListFile(big, context)
    expect(result).toMatchObject({ status: 'refused', message: 'The file is too large to be an Item List (65 MB).' })
  })

  it('logs every import: when, who, PC, file, rows imported, bad rows and result', async () => {
    const { source, context, logFile } = await setup()
    await importItemListFile(source, context)
    const wrong = await wrongFile()
    await importItemListFile(wrong, context)
    const missing = join(context.dataFolder, 'gone.txt')
    await importItemListFile(missing, context)

    const lines = linesOf(await readFile(logFile, 'utf8'))
    expect(lines[0]).toBe(IMPORT_LOG_HEADER.join(','))
    expect(lines.slice(1).map(parseCsvLine)).toEqual([
      ['2026-10-19 09:15:00', 'chantm', 'PHARM-01', 'Item List', source, '118', '1', 'Imported'],
      [
        '2026-10-19 09:15:00',
        'chantm',
        'PHARM-01',
        'Item List',
        wrong,
        '0',
        '3',
        'Refused: This does not look like an Item List (item_phq.txt): most rows have fewer than 15 tab-separated columns.'
      ],
      ['2026-10-19 09:15:00', 'chantm', 'PHARM-01', 'Item List', missing, '0', '0', expect.stringMatching(/^Failed: The file could not be read: .*ENOENT/)]
    ])
  })

  it('still imports when the log cannot be written, with a warning', async () => {
    const { dataFolder, source, context } = await setup()
    await writeFile(join(dataFolder, 'blocked'), '')
    const { result } = await importItemListFile(source, { ...context, logFolder: join(dataFolder, 'blocked', 'logs') })
    expect(result.status).toBe('imported')
    expect(result.warning).toMatch(/^The import log could not be written: /)
    expect((await loadItemList(dataFolder)).status).toBe('ok')
  })
})

describe('loadItemList', () => {
  it('loads the saved Item List', async () => {
    const { dataFolder, source, context } = await setup()
    await importItemListFile(source, context)
    const loaded = await loadItemList(dataFolder)
    if (loaded.status !== 'ok') throw new Error(loaded.status)
    expect(loaded.list.info).toEqual(fixtureInfo)
    expect(lookupItem(loaded.list.index, 'AIR 01')?.baseUnit).toBe('CYN')
    expect(loaded.list.index.size).toBe(118)
  })

  it('reports a missing Item List', async () => {
    expect(await loadItemList(await tempFolder())).toEqual({ status: 'missing' })
  })

  it('refuses an items.dat changed outside the app', async () => {
    const { dataFolder, source, context } = await setup()
    await importItemListFile(source, context)
    const bytes = await readFile(itemListPath(dataFolder))
    bytes[bytes.length - 1] ^= 0xff
    await writeFile(itemListPath(dataFolder), bytes)
    expect(await loadItemList(dataFolder)).toEqual({ status: 'tampered', message: 'The Item List (items.dat) was changed outside the app.' })
  })

  it('refuses a sealed items.dat that holds something else', async () => {
    const dataFolder = await tempFolder()
    for (const value of [{ printerName: 'ZDesigner GX420t' }, { ...fixtureInfo, items: [['PARA01', 'X']] }, { ...fixtureInfo, items: [['PARA1', 'X', 'TAB']] }]) {
      await writeSealed(itemListPath(dataFolder), value)
      expect(await loadItemList(dataFolder)).toEqual({ status: 'unreadable', message: 'The Item List (items.dat) is not a valid Item List.' })
    }
  })
})

describe('createItemListSource: the Item List in use, shared by every PC', () => {
  it('loads items.dat, and uses an Item List this PC imports', async () => {
    const { dataFolder, source, context } = await setup()
    const items = createItemListSource(dataFolder)
    expect(await items.load()).toEqual({ status: 'missing' })
    expect(await items.current()).toBeNull()
    const result = await items.importFile(source, context)
    expect(result.status).toBe('imported')
    expect((await items.current())?.info).toEqual(fixtureInfo)
  })

  it('keeps the Item List in use when an import is refused', async () => {
    const { dataFolder, source, context } = await setup()
    const items = createItemListSource(dataFolder)
    await items.importFile(source, context)
    expect((await items.importFile(await wrongFile(), context)).status).toBe('refused')
    expect((await items.current())?.info).toEqual(fixtureInfo)
  })

  it('picks up an Item List another PC imported since', async () => {
    const { dataFolder, source, context } = await setup()
    const thisPc = createItemListSource(dataFolder)
    expect((await thisPc.load()).status).toBe('missing')

    await importItemListFile(source, { ...context, pcName: 'PHARM-02' })
    expect((await thisPc.current())?.info).toEqual({ ...fixtureInfo, pc: 'PHARM-02' })

    const smaller = join(await tempFolder(), 'item_phq.txt')
    await writeFile(smaller, (await readFile(fixture, 'latin1')).split('\n').slice(0, 20).join('\n'), 'latin1')
    await importItemListFile(smaller, { ...context, pcName: 'PHARM-03' })
    expect((await thisPc.current())?.info).toMatchObject({ pc: 'PHARM-03', items: 20 })
  })

  it('loads afresh at startup: a damaged items.dat leaves no Item List in use', async () => {
    const { dataFolder, source, context } = await setup()
    const items = createItemListSource(dataFolder)
    await items.importFile(source, context)
    await writeFile(itemListPath(dataFolder), 'damaged')
    expect((await items.load()).status).toBe('tampered')
    expect(await items.current()).toBeNull()
  })

  it('keeps the verified Item List in use if items.dat is damaged later', async () => {
    const { dataFolder, source, context } = await setup()
    const items = createItemListSource(dataFolder)
    await items.importFile(source, context)
    await writeFile(itemListPath(dataFolder), 'damaged')
    expect((await items.current())?.info).toEqual(fixtureInfo)
  })
})
