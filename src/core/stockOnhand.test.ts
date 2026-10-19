import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexItems } from './itemList'
import {
  countItemsNotInItemList,
  describeStockOnhand,
  formatReportDate,
  indexStockLots,
  isStockOnhandForToday,
  parseStockOnhand,
  splitCsvLine,
  staleStockOnhandMessage,
  stockLotsFor,
  stockOnhandStatusText,
  stockOnhandValidity,
  type StockOnhandInfo
} from './stockOnhand'

/** The synthetic fixtures in the real `.ps` layout: Windows-1252, CRLF. */
const fixture = (name: string): string => readFileSync(join(__dirname, '../../test-fixtures', name), 'latin1')
const fixtureText = fixture('stock-onhand-synthetic.ps')

const HEADER_BLOCK = [
  'HA: INV Stock onhand with lot details',
  'Report Date: 19/10/2026 16:22:43',
  'Organization Code: NL0',
  'Subinventory Code: NL0-S-MAIN',
  'Item Code:',
  'Onhand Quantity Greater Than: 0'
]
const COLUMNS = 'Cluster,Org Code,Subinventory,Item Code,Item Description,Lot Number,Expiry Date,UOM,Onhand Quantity,Unit Cost,Onhand Value'

/** One row in the report's layout, Item Code and Lot written as Excel text `="…"`. */
function row(itemCode: string, lot: string, expiry = '01/01/2028', quantity = '10', description = 'SYNTHETIC ITEM', uom = 'TAB'): string {
  return ['DKW', 'NL0', 'NL0-S-MAIN', `"=""${itemCode}"""`, description, `"=""${lot}"""`, expiry, uom, quantity, '1', quantity].join(',')
}

/** `count` valid rows ZT0001… with one Lot each. */
function validRows(count: number): string[] {
  return Array.from({ length: count }, (_, i) => row(`ZT${String(i + 1).padStart(4, '0')}`, `L${i + 1}`))
}

function report(rows: readonly string[], { header = HEADER_BLOCK, columns = COLUMNS } = {}): string {
  return [...header, '', columns, ...rows].join('\r\n') + '\r\n'
}

function parsed(text: string) {
  const result = parseStockOnhand(text)
  if (!result.ok) throw new Error(result.message)
  return result
}

describe('parseStockOnhand over the synthetic fixture', () => {
  it('reads the Report Date, Organization and Subinventory from the header block', () => {
    expect(parsed(fixtureText).header).toEqual({
      reportDate: '2026-10-19',
      reportTime: '16:22:43',
      organizationCode: 'NL0',
      subinventoryCode: 'NL0-S-MAIN'
    })
  })

  it('imports the right counts: 121 rows, 118 Lots of 104 items, 1 bad row, 1 row without a Lot, 1 merged', () => {
    const result = parsed(fixtureText)
    expect(result.summary).toEqual({ rows: 121, items: 104, lots: 118, badRows: 1, withoutLot: 1, merged: 1 })
    expect(result.lots).toHaveLength(118)
  })

  it('unwraps ="…", converts the Expiry to YYMMDD as written and merges the repeated Lot by summing quantity', () => {
    const { lots } = parsed(fixtureText)
    expect(lots[0]).toEqual({
      itemCode: 'PARA01',
      description: 'SYNTHETIC FICTAMOL TABLET 500MG',
      lot: '2605261',
      expiry: '270525',
      uom: 'TAB',
      quantity: 1500
    })
  })

  it('keeps a Lot with a space or "/" as recorded (the Lot rules judge it when picked)', () => {
    const para01 = parsed(fixtureText).lots.filter((lot) => lot.itemCode === 'PARA01')
    expect(para01.map((lot) => [lot.lot, lot.expiry, lot.quantity])).toEqual([
      ['2605261', '270525', 1500],
      ['L/2026/07', '261231', 200],
      ['AB 123', '280301', 50],
      ['X0PAST1', '260930', 20]
    ])
  })

  it('recovers a description with an unquoted comma, and reads a quoted one', () => {
    const para18 = parsed(fixtureText).lots.filter((lot) => lot.itemCode === 'PARA18')
    expect(para18).toEqual([
      { itemCode: 'PARA18', description: 'SYNTHETIC FICTAMOL ORAL SOLUTION 120MG/5ML, SUGAR FREE', lot: 'P18A001', expiry: '270601', uom: 'ML', quantity: 2400 },
      { itemCode: 'PARA18', description: 'SYNTHETIC FICTAMOL ORAL SOLUTION 120MG/5ML, SUGAR FREE', lot: 'P18B002', expiry: '270215', uom: 'ML', quantity: 1200 }
    ])
  })

  it('keeps Item Codes with a space, "-", "&" and ".", and reads latin1 text', () => {
    const { lots } = parsed(fixtureText)
    expect(lots.find((lot) => lot.itemCode === 'AIR 01')).toMatchObject({ lot: 'G-7781', expiry: '280815', uom: 'CYN', quantity: 4 })
    expect(lots.find((lot) => lot.itemCode === 'ZQ-A&.')).toMatchObject({ lot: 'EDGE-1', expiry: '290101' })
    expect(lots.find((lot) => lot.itemCode === 'ZQB120')).toMatchObject({ description: 'SYNTHETIC IMAGINAMIN INJECTION 1000µG/ML', lot: 'IMG(24)01' })
  })

  it('skips the row without a Lot, without counting it as bad', () => {
    expect(parsed(fixtureText).lots.some((lot) => lot.itemCode === 'BAG Z9')).toBe(false)
  })

  it('reports the bad row by line number', () => {
    expect(parsed(fixtureText).badRows).toEqual([{ line: 70, message: 'Line 70: Expiry Date "31/02/2027" is not a date as dd/mm/yyyy.' }])
  })

  it('reads LF line endings and a UTF-8 BOM the same as CRLF', () => {
    const expected = parseStockOnhand(fixtureText)
    expect(parseStockOnhand(fixtureText.replace(/\r\n/g, '\n'))).toEqual(expected)
    expect(parseStockOnhand('﻿' + fixtureText)).toEqual(expected)
  })
})

describe('parseStockOnhand refusals', () => {
  it('refuses a report with no Report Date line', () => {
    const result = parseStockOnhand(fixture('stock-onhand-no-report-date.ps'))
    expect(result).toMatchObject({ ok: false, header: null, summary: null })
    expect(!result.ok && result.message).toBe(
      'The report has no "Report Date:" line, so the day it is valid for is unknown. Use the report "HA: INV Stock onhand with lot details".'
    )
  })

  it('refuses a Report Date that is not dd/mm/yyyy hh:mm:ss', () => {
    for (const value of ['2026-10-19 16:22:43', '31/02/2026 08:00:00', '19/10/2026 25:00:00', '']) {
      const header = HEADER_BLOCK.map((line) => (line.startsWith('Report Date') ? `Report Date: ${value}` : line))
      const result = parseStockOnhand(report(validRows(5), { header }))
      expect(!result.ok && result.message).toBe(`The Report Date "${value}" is not a date and time as dd/mm/yyyy hh:mm:ss.`)
    }
  })

  it('accepts a Report Date without seconds or time', () => {
    const header = (value: string) => HEADER_BLOCK.map((line) => (line.startsWith('Report Date') ? `Report Date: ${value}` : line))
    expect(parsed(report(validRows(5), { header: header('9/1/2027 7:05') })).header).toMatchObject({ reportDate: '2027-01-09', reportTime: '07:05:00' })
    expect(parsed(report(validRows(5), { header: header('09/01/2027') })).header).toMatchObject({ reportDate: '2027-01-09', reportTime: null })
  })

  it('refuses a report whose required column is renamed', () => {
    const result = parseStockOnhand(fixture('stock-onhand-renamed-column.ps'))
    expect(result).toMatchObject({ ok: false, header: { reportDate: '2026-10-19' }, summary: null })
    expect(!result.ok && result.message).toBe(
      'The report has no "Lot Number" column. Its header row needs Item Code, Item Description, Lot Number, Expiry Date, UOM and Onhand Quantity.'
    )
  })

  it('names every missing required column', () => {
    const columns = 'Cluster,Org Code,Subinventory,Item,Item Description,Lot Number,Expiry Date,Unit,Onhand Quantity'
    const result = parseStockOnhand(report(validRows(5), { columns }))
    expect(!result.ok && result.message).toMatch(/^The report has no "Item Code" or "UOM" column\. /)
  })

  it('refuses a file with no header row after the header block', () => {
    const result = parseStockOnhand(HEADER_BLOCK.join('\r\n') + '\r\n\r\n\r\n')
    expect(!result.ok && result.message).toBe('The report has no column header row after its header block.')
  })

  it('refuses the Item List chosen by mistake', () => {
    const itemList = ['PARA01', 'SYNTHETIC FICTAMOL TABLET 500MG', ...Array.from({ length: 12 }, () => ''), 'TAB'].join('\t')
    const result = parseStockOnhand(`${itemList}\r\n${itemList}\r\n`)
    expect(!result.ok && result.message).toMatch(/^The report has no "Report Date:" line/)
  })

  it('accepts exactly 1% bad rows and refuses more', () => {
    const bad = row('ZQ001', 'X1')
    expect(parseStockOnhand(report([bad, ...validRows(99)]))).toMatchObject({ ok: true, summary: { rows: 100, badRows: 1 } })
    const over = parseStockOnhand(report([bad, bad, ...validRows(98)]))
    expect(over).toMatchObject({ ok: false, summary: { rows: 100, lots: 98, badRows: 2 } })
    expect(!over.ok && over.message).toBe('2 of 100 rows are not valid Stock Onhand rows (more than 1%).')
  })

  it('refuses the fixture with one more bad row', () => {
    const result = parseStockOnhand(fixtureText + row('ZT0051', 'ZT51L9', '1/13/2027') + '\r\n')
    expect(result).toMatchObject({ ok: false, summary: { rows: 122, badRows: 2 } })
  })

  it('refuses a report with no rows, or no row with a Lot', () => {
    expect(parseStockOnhand(report([]))).toMatchObject({ ok: false, message: 'The report has no Stock Onhand rows.' })
    expect(parseStockOnhand(report([row('ZT0001', ''), row('ZT0002', '')]))).toMatchObject({
      ok: false,
      message: 'The report has no Stock Onhand rows with a Lot.',
      summary: { rows: 2, withoutLot: 2 }
    })
  })
})

describe('parseStockOnhand rows', () => {
  it('finds the columns by name, in any order and case, without the optional ones', () => {
    const columns = 'lot number,ONHAND QUANTITY,Item Code,Expiry  Date,UOM,Item Description'
    const reordered = parsed(report(['"=""B7""",12.5,"=""PARA18""",01/02/2028,ML,SYNTHETIC SYRUP'], { columns }))
    expect(reordered.lots).toEqual([{ itemCode: 'PARA18', description: 'SYNTHETIC SYRUP', lot: 'B7', expiry: '280201', uom: 'ML', quantity: 12.5 }])
  })

  it('recovers several unquoted commas in the description of the standard layout', () => {
    const { lots } = parsed(report([row('ZT0001', 'L1', '01/01/2028', '10', 'A, B, C')]))
    expect(lots[0].description).toBe('A, B, C')
    expect(lots[0]).toMatchObject({ lot: 'L1', expiry: '280101', quantity: 10 })
  })

  it('counts a row with extra fields as bad when the header is not the standard layout', () => {
    const columns = 'Item Code,Item Description,Lot Number,Expiry Date,UOM,Onhand Quantity'
    const result = parseStockOnhand(report(['"=""ZT0001""",A, B,"=""L1""",01/01/2028,TAB,5', ...Array.from({ length: 150 }, (_, i) => `"=""ZT${String(i + 2).padStart(4, '0')}""",X,"=""L""",01/01/2028,TAB,5`)], { columns }))
    expect(result.badRows[0]).toEqual({ line: 9, message: 'Line 9: 7 fields; the header row has 6.' })
  })

  it('counts a row with too few fields, an invalid Item Code, Expiry or quantity as bad', () => {
    const result = parseStockOnhand(
      report([
        'DKW,NL0,NL0-S-MAIN,"=""ZT9001"""',
        row('ZT_002', 'L2'),
        row('ZT9003', 'L3', '2028-01-01'),
        row('ZT9004', 'L4', '01/01/1999'),
        row('ZT9005', 'L5', '01/01/2028', 'many'),
        row('ZT9006', 'L6', '01/01/2028', ''),
        'DKW,NL0,NL0-S-MAIN,"=""ZT9007""",X,"=""L7""",01/01/2028,TAB,"1,000,1,1000',
        ...validRows(700)
      ])
    )
    expect(result.badRows.map((bad) => bad.message)).toEqual([
      'Line 9: 4 fields; the header row has 11.',
      expect.stringMatching(/^Line 10: Item Code "ZT_002" contains "_"/),
      'Line 11: Expiry Date "2028-01-01" is not a date as dd/mm/yyyy.',
      'Line 12: Expiry Date "01/01/1999" is outside 2000–2099.',
      'Line 13: Onhand Quantity "many" is not a number.',
      'Line 14: Onhand Quantity "" is not a number.',
      'Line 15: a quoted field has no closing quote.'
    ])
    expect(result).toMatchObject({ ok: true, summary: { rows: 707, badRows: 7, lots: 700 } })
  })

  it('takes the Item Code exactly as written (a space is an Item Code character) but trims the Lot', () => {
    const result = parseStockOnhand(report([row('ZT0001 ', 'L1'), row('para01', '  2605261 '), ...validRows(300).slice(1)]))
    expect(result.badRows.map((bad) => bad.message)).toEqual(['Line 9: Item Code must be exactly 6 characters; got 7.'])
    expect(result.ok && result.lots[0]).toMatchObject({ itemCode: 'PARA01', lot: '2605261' })
  })

  it('keeps a Lot with no Expiry, with no Expiry', () => {
    const { lots } = parsed(report([row('ZT0001', 'NOEXP', '')]))
    expect(lots[0]).toMatchObject({ lot: 'NOEXP', expiry: null })
  })

  it('reads quantities with decimals and thousands separators, and sums them without float noise', () => {
    const { lots } = parsed(report([row('ZT0001', 'L1', '01/01/2028', '"1,250.5"'), row('ZT0001', 'L1', '01/01/2028', '0.1'), row('ZT0001', 'L1', '01/01/2028', '.2')]))
    expect(lots).toHaveLength(1)
    expect(lots[0].quantity).toBe(1250.8)
  })

  it('counts a repeated Lot with another Expiry as bad and keeps the first', () => {
    const result = parseStockOnhand(report([row('ZT0001', 'L1', '01/01/2028', '5'), row('ZT0001', 'L1', '01/02/2028', '7'), ...validRows(200).slice(1)]))
    expect(result.badRows).toEqual([{ line: 10, message: 'Line 10: Lot L1 of ZT0001 is listed again with another Expiry Date (01/02/2028).' }])
    expect(result.ok && result.lots[0]).toMatchObject({ lot: 'L1', expiry: '280101', quantity: 5 })
  })

  it('treats the same Lot of two items as two Lots', () => {
    const { summary } = parsed(report([row('ZT0001', 'L1'), row('ZT0002', 'L1')]))
    expect(summary).toMatchObject({ items: 2, lots: 2, merged: 0 })
  })

  it('skips blank lines without counting them as rows, but keeps line numbers', () => {
    const result = parseStockOnhand(report(['', row('ZT0001', 'L1'), '   ', row('ZT0002', 'L2', '32/01/2028'), ...validRows(200).slice(2)]))
    expect(result.summary?.rows).toBe(200)
    expect(result.badRows[0].line).toBe(12)
  })
})

describe('splitCsvLine', () => {
  it('splits RFC 4180 fields', () => {
    expect(splitCsvLine('a,"b,c","d ""e""",,f')).toEqual(['a', 'b,c', 'd "e"', '', 'f'])
    expect(splitCsvLine('"=""PARA01"""')).toEqual(['="PARA01"'])
    expect(splitCsvLine('')).toEqual([''])
    expect(splitCsvLine('a,')).toEqual(['a', ''])
  })

  it('keeps a quote inside an unquoted field, and refuses an unclosed quoted field', () => {
    expect(splitCsvLine('BANDAGE 5" WIDE,x')).toEqual(['BANDAGE 5" WIDE', 'x'])
    expect(splitCsvLine('a,"b')).toBeNull()
  })
})

const info: StockOnhandInfo = {
  sourceFileName: 'stock.ps',
  sourceModified: '2026-10-19T08:30:00.000Z',
  importedAt: '2026-10-19T09:00:00.000Z',
  importedBy: 'chantm',
  pc: 'PHARM-01',
  reportDate: '2026-10-19',
  reportTime: '16:22:43',
  organizationCode: 'NL0',
  subinventoryCode: 'NL0-S-MAIN',
  items: 104,
  lots: 1118
}

describe('the Report Date rule: Stock Onhand is valid only on its Report Date', () => {
  it('is usable on its Report Date only', () => {
    expect(isStockOnhandForToday(info, '2026-10-19')).toBe(true)
    expect(isStockOnhandForToday(info, '2026-10-20')).toBe(false)
    expect(isStockOnhandForToday(info, '2026-10-18')).toBe(false)
    expect(isStockOnhandForToday(null, '2026-10-19')).toBe(false)
  })

  it('names its state for today', () => {
    expect(stockOnhandValidity(info, '2026-10-19')).toBe('today')
    expect(stockOnhandValidity(info, '2026-10-20')).toBe('stale')
    expect(stockOnhandValidity(null, '2026-10-20')).toBe('none')
  })

  it('describes it for the header', () => {
    expect(stockOnhandStatusText(info, '2026-10-19')).toBe('Stock Onhand: 19 Oct 2026 (NL0-S-MAIN)')
    expect(stockOnhandStatusText(info, '2026-10-20')).toBe("Stock Onhand: dated 19 Oct 2026 — import today's file")
    expect(stockOnhandStatusText(null, '2026-10-20')).toBe('Stock Onhand: none')
    expect(stockOnhandStatusText({ ...info, subinventoryCode: '' }, '2026-10-19')).toBe('Stock Onhand: 19 Oct 2026 (NL0)')
    expect(stockOnhandStatusText({ ...info, subinventoryCode: '', organizationCode: '' }, '2026-10-19')).toBe('Stock Onhand: 19 Oct 2026')
  })

  it('explains a stale Stock Onhand', () => {
    expect(staleStockOnhandMessage({ ...info, reportDate: '2026-10-18' })).toBe("Stock Onhand is dated 18 Oct 2026. Import today's file to pick a Lot.")
  })

  it('summarises it', () => {
    expect(describeStockOnhand(info)).toBe('1,118 Lots of 104 items, Report Date 19 Oct 2026 16:22:43, NL0-S-MAIN')
    expect(describeStockOnhand({ ...info, reportTime: null, lots: 1, items: 1, subinventoryCode: '', organizationCode: '' })).toBe('1 Lot of 1 item, Report Date 19 Oct 2026')
  })

  it('formats a Report Date', () => {
    expect(formatReportDate('2026-01-09')).toBe('09 Jan 2026')
    expect(formatReportDate('not a date')).toBe('unknown date')
  })
})

describe('stockLotsFor', () => {
  const lots = parsed(fixtureText).lots
  const index = indexStockLots(lots)

  it("lists an item's Lots in file order, a–z upper-cased first", () => {
    expect(stockLotsFor(index, 'para18').map((lot) => lot.lot)).toEqual(['P18A001', 'P18B002'])
    expect(stockLotsFor(index, 'AIR 01').map((lot) => lot.lot)).toEqual(['G-7781'])
  })

  it('lists nothing for an item with no Lots', () => {
    expect(stockLotsFor(index, 'BAG Z9')).toEqual([])
    expect(stockLotsFor(index, 'NOPE01')).toEqual([])
  })

  it('counts the items not in the Item List', () => {
    const items = indexItems([
      { itemCode: 'PARA01', name: 'A', baseUnit: 'TAB' },
      { itemCode: 'PARA18', name: 'B', baseUnit: 'ML' }
    ])
    expect(countItemsNotInItemList(index, items)).toBe(index.size - 2)
    expect(countItemsNotInItemList(indexStockLots(lots.filter((lot) => lot.itemCode.startsWith('PARA'))), items)).toBe(0)
  })
})
