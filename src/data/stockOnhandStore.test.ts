import { readFileSync } from 'node:fs'
import { copyFile, readFile, truncate, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexItems, parseItemList } from '../core/itemList'
import { stockLotsFor } from '../core/stockOnhand'
import { linesOf, parseCsvLine } from './csvTesting'
import { IMPORT_LOG_HEADER } from './importLog'
import { readSealed, writeSealed } from './sealed'
import {
  createStockOnhandSource,
  importStockOnhandFile,
  loadStockOnhand,
  MAX_STOCK_ONHAND_FILE_BYTES,
  STOCK_ONHAND_FILE_NAME,
  stockOnhandPath,
  type StockOnhandImportContext
} from './stockOnhandStore'
import { tempFolder } from './testFolder'

const fixtures = join(__dirname, '../../test-fixtures')
const fixture = join(fixtures, 'stock-onhand-synthetic.ps')

/** The file's last-modified time: 19 Oct 2026 16:25:10 local. */
const modified = new Date(2026, 9, 19, 16, 25, 10)
/** 19 Oct 2026 17:00:00 local. */
const now = new Date(2026, 9, 19, 17, 0, 0)

const fixtureInfo = {
  sourceFileName: 'stock_onhand.ps',
  sourceModified: modified.toISOString(),
  importedAt: now.toISOString(),
  importedBy: 'chantm',
  pc: 'PHARM-01',
  reportDate: '2026-10-19',
  reportTime: '16:22:43',
  organizationCode: 'NL0',
  subinventoryCode: 'NL0-S-MAIN',
  items: 104,
  lots: 118
}

/** The Item List fixture's items: every Stock Onhand fixture item but ZZN001. */
const itemList = parseItemList(readFileSync(join(fixtures, 'item_phq-synthetic.txt'), 'latin1'))
if (!itemList.ok) throw new Error(itemList.message)
const itemIndex = indexItems(itemList.items)

/** A data folder, and the synthetic fixture copied as `stock_onhand.ps` with a known modified time. */
async function setup() {
  const dataFolder = await tempFolder()
  const source = join(await tempFolder(), 'stock_onhand.ps')
  await copyFile(fixture, source)
  await utimes(source, modified, modified)
  const context: StockOnhandImportContext = {
    dataFolder,
    logFolder: join(dataFolder, 'logs'),
    pcName: 'PHARM-01',
    windowsUser: 'chantm',
    now: () => now,
    itemIndex
  }
  const logFile = join(dataFolder, 'logs', 'import-log-2026-10-PHARM-01.csv')
  return { dataFolder, source, context, logFile }
}

describe('importStockOnhandFile', () => {
  it('imports the fixture into a sealed stock.dat, with its summary, Report Date and where it came from', async () => {
    const { dataFolder, source, context } = await setup()
    const { result, stock } = await importStockOnhandFile(source, context)
    expect(result).toEqual({
      status: 'imported',
      info: fixtureInfo,
      summary: { rows: 121, items: 104, lots: 118, badRows: 1, withoutLot: 1, merged: 1 },
      badRows: [{ line: 70, message: 'Line 70: Expiry Date "31/02/2027" is not a date as dd/mm/yyyy.' }],
      notInItemList: 1,
      warning: null
    })
    expect(stock?.info).toEqual(fixtureInfo)
    expect(stock && stockLotsFor(stock.index, 'para01').map((lot) => [lot.lot, lot.expiry, lot.quantity])).toEqual([
      ['2605261', '270525', 1500],
      ['L/2026/07', '261231', 200],
      ['AB 123', '280301', 50],
      ['X0PAST1', '260930', 20]
    ])

    const bytes = await readFile(stockOnhandPath(dataFolder))
    expect(stockOnhandPath(dataFolder)).toBe(join(dataFolder, STOCK_ONHAND_FILE_NAME))
    expect(STOCK_ONHAND_FILE_NAME).toBe('stock.dat')
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('TDCP')
    expect(bytes.toString('latin1')).not.toContain('2605261')
  })

  it('stores the file details, Report Date and each Lot as [Item Code, Lot, Expiry, UOM, quantity]', async () => {
    const { dataFolder, source, context } = await setup()
    await importStockOnhandFile(source, context)
    const stored = await readSealed(stockOnhandPath(dataFolder))
    if (stored.status !== 'ok') throw new Error(stored.status)
    const { lots, ...details } = stored.value as { lots: unknown[] }
    expect(details).toEqual({
      sourceFileName: 'stock_onhand.ps',
      sourceModified: modified.toISOString(),
      importedAt: now.toISOString(),
      importedBy: 'chantm',
      pc: 'PHARM-01',
      reportDate: '2026-10-19',
      reportTime: '16:22:43',
      organizationCode: 'NL0',
      subinventoryCode: 'NL0-S-MAIN'
    })
    expect(lots).toHaveLength(118)
    expect(lots[0]).toEqual(['PARA01', '2605261', '270525', 'TAB', 1500])
    expect(lots).toContainEqual(['AIR 01', 'G-7781', '280815', 'CYN', 4])
  })

  it('reads a UTF-8 file with a BOM the same as the Windows-1252 one', async () => {
    const { source, context } = await setup()
    const utf8 = join(await tempFolder(), 'stock_onhand.ps')
    await writeFile(utf8, '﻿' + (await readFile(source, 'latin1')), 'utf8')
    await utimes(utf8, modified, modified)
    const { result } = await importStockOnhandFile(utf8, context)
    expect(result).toMatchObject({ status: 'imported', info: fixtureInfo })
  })

  it('reports no Item List count when there is no Item List', async () => {
    const { source, context } = await setup()
    const { result } = await importStockOnhandFile(source, { ...context, itemIndex: null })
    expect(result).toMatchObject({ status: 'imported', notInItemList: null })
  })

  it('refuses a report with no Report Date, or a renamed column, and keeps the previous Stock Onhand', async () => {
    const { dataFolder, source, context } = await setup()
    await importStockOnhandFile(source, context)
    const before = await readFile(stockOnhandPath(dataFolder))

    const noDate = await importStockOnhandFile(join(fixtures, 'stock-onhand-no-report-date.ps'), context)
    expect(noDate).toEqual({
      result: {
        status: 'refused',
        message: 'The report has no "Report Date:" line, so the day it is valid for is unknown. Use the report "HA: INV Stock onhand with lot details".',
        summary: null,
        badRows: [],
        warning: null
      },
      stock: null
    })
    const renamed = await importStockOnhandFile(join(fixtures, 'stock-onhand-renamed-column.ps'), context)
    expect(renamed.result).toMatchObject({ status: 'refused', message: expect.stringMatching(/^The report has no "Lot Number" column\./) })

    expect(await readFile(stockOnhandPath(dataFolder))).toEqual(before)
    const loaded = await loadStockOnhand(dataFolder)
    expect(loaded.status === 'ok' && loaded.stock.info).toEqual(fixtureInfo)
  })

  it('refuses a report with more than 1% bad rows, keeping the previous Stock Onhand', async () => {
    const { dataFolder, source, context } = await setup()
    await importStockOnhandFile(source, context)
    const before = await readFile(stockOnhandPath(dataFolder))
    const worse = join(await tempFolder(), 'stock_onhand.ps')
    await writeFile(worse, (await readFile(fixture, 'latin1')) + 'DKW,NL0,NL0-S-MAIN,"=""ZT0051""",X,"=""L9""",1/13/2027,TAB,1,1,1\r\n', 'latin1')

    const { result } = await importStockOnhandFile(worse, context)
    expect(result).toMatchObject({ status: 'refused', message: '2 of 122 rows are not valid Stock Onhand rows (more than 1%).', summary: { badRows: 2 } })
    expect(await readFile(stockOnhandPath(dataFolder))).toEqual(before)
  })

  it('creates no stock.dat when the first import is refused', async () => {
    const { dataFolder, context } = await setup()
    const { result } = await importStockOnhandFile(join(fixtures, 'stock-onhand-no-report-date.ps'), context)
    expect(result.status).toBe('refused')
    expect(await loadStockOnhand(dataFolder)).toEqual({ status: 'missing' })
  })

  it('refuses a file it cannot read', async () => {
    const { dataFolder, context } = await setup()
    const { result } = await importStockOnhandFile(join(dataFolder, 'no-such-file.ps'), context)
    expect(result).toMatchObject({ status: 'refused', summary: null, badRows: [] })
    expect(result.status === 'refused' && result.message).toMatch(/^The file could not be read: .*ENOENT/)
  })

  it('refuses a file too large to be a Stock Onhand report without reading it', async () => {
    const { context } = await setup()
    const big = join(await tempFolder(), 'big.ps')
    await writeFile(big, '')
    await truncate(big, MAX_STOCK_ONHAND_FILE_BYTES + 1)
    const { result } = await importStockOnhandFile(big, context)
    expect(result).toMatchObject({ status: 'refused', message: 'The file is too large to be a Stock Onhand report (65 MB).' })
  })

  it('logs every import as Stock Onhand: when, who, PC, file, Lots imported, bad rows and result', async () => {
    const { source, context, logFile } = await setup()
    await importStockOnhandFile(source, context)
    const noDate = join(fixtures, 'stock-onhand-no-report-date.ps')
    await importStockOnhandFile(noDate, context)
    const missing = join(context.dataFolder, 'gone.ps')
    await importStockOnhandFile(missing, context)

    const lines = linesOf(await readFile(logFile, 'utf8'))
    expect(lines[0]).toBe(IMPORT_LOG_HEADER.join(','))
    expect(lines.slice(1).map(parseCsvLine)).toEqual([
      ['2026-10-19 17:00:00', 'chantm', 'PHARM-01', 'Stock Onhand', source, '118', '1', 'Imported'],
      [
        '2026-10-19 17:00:00',
        'chantm',
        'PHARM-01',
        'Stock Onhand',
        noDate,
        '0',
        '0',
        'Refused: The report has no "Report Date:" line, so the day it is valid for is unknown. Use the report "HA: INV Stock onhand with lot details".'
      ],
      ['2026-10-19 17:00:00', 'chantm', 'PHARM-01', 'Stock Onhand', missing, '0', '0', expect.stringMatching(/^Failed: The file could not be read: .*ENOENT/)]
    ])
  })

  it('still imports when the log cannot be written, with a warning', async () => {
    const { dataFolder, source, context } = await setup()
    await writeFile(join(dataFolder, 'blocked'), '')
    const { result } = await importStockOnhandFile(source, { ...context, logFolder: join(dataFolder, 'blocked', 'logs') })
    expect(result.status).toBe('imported')
    expect(result.warning).toMatch(/^The import log could not be written: /)
    expect((await loadStockOnhand(dataFolder)).status).toBe('ok')
  })
})

describe('loadStockOnhand', () => {
  it('loads the saved Stock Onhand', async () => {
    const { dataFolder, source, context } = await setup()
    await importStockOnhandFile(source, context)
    const loaded = await loadStockOnhand(dataFolder)
    if (loaded.status !== 'ok') throw new Error(loaded.status)
    expect(loaded.stock.info).toEqual(fixtureInfo)
    expect(stockLotsFor(loaded.stock.index, 'PARA18').map((lot) => lot.lot)).toEqual(['P18A001', 'P18B002'])
    expect(loaded.stock.index.size).toBe(104)
  })

  it('reports a missing Stock Onhand', async () => {
    expect(await loadStockOnhand(await tempFolder())).toEqual({ status: 'missing' })
  })

  it('refuses a stock.dat changed outside the app', async () => {
    const { dataFolder, source, context } = await setup()
    await importStockOnhandFile(source, context)
    const bytes = await readFile(stockOnhandPath(dataFolder))
    bytes[bytes.length - 1] ^= 0xff
    await writeFile(stockOnhandPath(dataFolder), bytes)
    expect(await loadStockOnhand(dataFolder)).toEqual({ status: 'tampered', message: 'The Stock Onhand (stock.dat) was changed outside the app.' })
  })

  it('refuses a sealed stock.dat that holds something else', async () => {
    const dataFolder = await tempFolder()
    const { items: _items, lots: _lots, ...details } = fixtureInfo
    for (const value of [
      { printerName: 'ZDesigner GX420t' },
      { ...details, lots: [['PARA01', 'L1', '280101', 'TAB']] },
      { ...details, lots: [['PARA1', 'L1', '280101', 'TAB', 5]] },
      { ...details, lots: [['PARA01', 'L1', '28-01-01', 'TAB', 5]] },
      { ...details, lots: [['PARA01', 'L1', '280101', 'TAB', '5']] },
      { ...details, reportDate: '19/10/2026', lots: [] }
    ]) {
      await writeSealed(stockOnhandPath(dataFolder), value)
      expect(await loadStockOnhand(dataFolder)).toEqual({ status: 'unreadable', message: 'The Stock Onhand (stock.dat) is not a valid Stock Onhand.' })
    }
  })
})

describe('createStockOnhandSource: the Stock Onhand in use, shared by every PC', () => {
  it('loads stock.dat, and uses a Stock Onhand this PC imports', async () => {
    const { dataFolder, source, context } = await setup()
    const stock = createStockOnhandSource(dataFolder)
    expect(await stock.load()).toEqual({ status: 'missing' })
    expect(await stock.current()).toBeNull()
    expect((await stock.importFile(source, context)).status).toBe('imported')
    expect((await stock.current())?.info).toEqual(fixtureInfo)
  })

  it('keeps the Stock Onhand in use when an import is refused', async () => {
    const { dataFolder, source, context } = await setup()
    const stock = createStockOnhandSource(dataFolder)
    await stock.importFile(source, context)
    expect((await stock.importFile(join(fixtures, 'stock-onhand-renamed-column.ps'), context)).status).toBe('refused')
    expect((await stock.current())?.info).toEqual(fixtureInfo)
  })

  it('picks up a Stock Onhand another PC imported since', async () => {
    const { dataFolder, source, context } = await setup()
    const thisPc = createStockOnhandSource(dataFolder)
    expect((await thisPc.load()).status).toBe('missing')

    await importStockOnhandFile(source, { ...context, pcName: 'PHARM-02' })
    expect((await thisPc.current())?.info).toEqual({ ...fixtureInfo, pc: 'PHARM-02' })

    const tomorrow = join(await tempFolder(), 'stock_onhand.ps')
    await writeFile(tomorrow, (await readFile(fixture, 'latin1')).replace('Report Date: 19/10/2026', 'Report Date: 20/10/2026'), 'latin1')
    await importStockOnhandFile(tomorrow, { ...context, pcName: 'PHARM-03' })
    expect((await thisPc.current())?.info).toMatchObject({ pc: 'PHARM-03', reportDate: '2026-10-20' })
  })

  it('loads afresh at startup: a damaged stock.dat leaves no Stock Onhand in use', async () => {
    const { dataFolder, source, context } = await setup()
    const stock = createStockOnhandSource(dataFolder)
    await stock.importFile(source, context)
    await writeFile(stockOnhandPath(dataFolder), 'damaged')
    expect((await stock.load()).status).toBe('tampered')
    expect(await stock.current()).toBeNull()
  })

  it('keeps the verified Stock Onhand in use if stock.dat is damaged later', async () => {
    const { dataFolder, source, context } = await setup()
    const stock = createStockOnhandSource(dataFolder)
    await stock.importFile(source, context)
    await writeFile(stockOnhandPath(dataFolder), 'damaged')
    expect((await stock.current())?.info).toEqual(fixtureInfo)
  })
})
