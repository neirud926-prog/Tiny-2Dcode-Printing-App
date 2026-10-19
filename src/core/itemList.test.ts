import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  describeItemList,
  formatFileDate,
  indexItems,
  isLiquid,
  itemListProblems,
  lookupItem,
  parseItemList,
  type ItemListEntry,
  type ItemListInfo
} from './itemList'

/** The synthetic fixture in the real `item_phq.txt` layout: 48 tab columns, latin1, LF, no header. */
const fixtureText = readFileSync(join(__dirname, '../../test-fixtures/item_phq-synthetic.txt'), 'latin1')

/** One Item List row with 48 columns: Item Code, drug name and base unit in columns 0, 1 and 14. */
function row(itemCode: string, name: string, baseUnit: string, columns = 48): string {
  const cells = Array.from({ length: columns }, () => '')
  cells[0] = itemCode
  if (columns > 1) cells[1] = name
  if (columns > 14) cells[14] = baseUnit
  return cells.join('\t')
}

/** A file of `count` valid tablet rows ZT0001…, LF-terminated. */
function validRows(count: number): string[] {
  return Array.from({ length: count }, (_, i) => row(`ZT${String(i + 1).padStart(4, '0')}`, `SYNTHETIC ITEM ${i + 1}`, 'TAB'))
}

function parsed(text: string) {
  const result = parseItemList(text)
  if (!result.ok) throw new Error(result.message)
  return result
}

describe('parseItemList over the synthetic fixture', () => {
  it('imports the right counts: 120 rows, 118 items, 12 liquids, 1 bad row, 1 duplicate', () => {
    const result = parsed(fixtureText)
    expect(result.summary).toEqual({ rows: 120, items: 118, liquids: 12, badRows: 1, duplicates: 1 })
    expect(result.items).toHaveLength(118)
  })

  it('keeps Item Code, drug name and base unit', () => {
    const { items } = parsed(fixtureText)
    expect(items[0]).toEqual({ itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' })
    expect(items.find((item) => item.itemCode === 'PARA18')).toEqual({
      itemCode: 'PARA18',
      name: 'SYNTHETIC FICTAMOL ORAL SOLUTION 120MG/5ML',
      baseUnit: 'ML'
    })
  })

  it('keeps Item Codes with a space, "-", "&" and "."', () => {
    const codes = parsed(fixtureText).items.map((item) => item.itemCode)
    expect(codes).toEqual(expect.arrayContaining(['AIR 01', 'SYR-05', 'S&W 01', 'VIT.B1', 'BAG Z9', 'ZQ-A&.']))
  })

  it('reads drug names as latin1', () => {
    const names = parsed(fixtureText).items.map((item) => item.name)
    expect(names).toContain('SYNTHETIC IMAGINAMIN INJECTION 1000µG/ML')
    expect(names).toContain('SYNTHETIC CRÈME FICTIVE 50G')
  })

  it('reports the malformed row by line number', () => {
    expect(parsed(fixtureText).badRows).toEqual([{ line: 41, message: 'Line 41: Item Code must be exactly 6 characters; got 5.' }])
  })

  it('keeps the first of two rows with the same Item Code', () => {
    const { items } = parsed(fixtureText)
    expect(items.filter((item) => item.itemCode === 'ZT0010')).toEqual([{ itemCode: 'ZT0010', name: 'SYNTHETIC TEST ITEM 010 TABLET 50MG', baseUnit: 'TAB' }])
  })

  it('reads CRLF line endings the same as LF', () => {
    expect(parseItemList(fixtureText.replace(/\n/g, '\r\n'))).toEqual(parseItemList(fixtureText))
  })
})

describe('parseItemList rows', () => {
  it('trims the drug name and base unit, and upper-cases the base unit', () => {
    const { items } = parsed(row('ZT0001', '  SYNTHETIC SYRUP  ', ' ml ') + '\n')
    expect(items).toEqual([{ itemCode: 'ZT0001', name: 'SYNTHETIC SYRUP', baseUnit: 'ML' }])
  })

  it('upper-cases a lower-case Item Code, and counts it as a duplicate of the upper-case one', () => {
    const result = parsed([row('zt0001', 'A', 'TAB'), row('ZT0001', 'B', 'TAB'), ...validRows(200).slice(1)].join('\n'))
    expect(result.items[0]).toEqual({ itemCode: 'ZT0001', name: 'A', baseUnit: 'TAB' })
    expect(result.summary.duplicates).toBe(1)
  })

  it('takes the Item Code exactly as written: no trimming, since a space is an Item Code character', () => {
    const result = parseItemList([row('ZT0001 ', 'PADDED', 'TAB'), row(' ZT0002', 'PADDED', 'TAB'), ...validRows(300).slice(2)].join('\n'))
    expect(result.ok).toBe(true)
    expect(result.badRows.map((bad) => bad.message)).toEqual([
      'Line 1: Item Code must be exactly 6 characters; got 7.',
      'Line 2: Item Code must be exactly 6 characters; got 7.'
    ])
  })

  it('refuses a row with an Item Code character outside the 40', () => {
    const result = parseItemList([row('ZT_001', 'X', 'TAB'), ...validRows(150)].join('\n'))
    expect(result.badRows[0].message).toMatch(/^Line 1: Item Code "ZT_001" contains "_"/)
  })

  it('refuses a row with fewer than 15 columns, no drug name or no base unit', () => {
    const result = parseItemList([row('ZT9001', 'SHORT', 'TAB', 14), row('ZT9002', '  ', 'TAB'), row('ZT9003', 'NO UNIT', ' '), ...validRows(400)].join('\n'))
    expect(result.badRows.map((bad) => bad.message)).toEqual([
      'Line 1: 14 columns; an Item List row has at least 15.',
      'Line 2: no drug name.',
      'Line 3: no base unit.'
    ])
    expect(result.summary).toMatchObject({ rows: 403, items: 400, badRows: 3 })
  })

  it('skips blank lines without counting them as rows, but keeps line numbers', () => {
    const result = parseItemList(['', row('ZT0001', 'A', 'TAB'), '   ', row('ZT_02X', 'B', 'TAB'), ...validRows(200).slice(1), ''].join('\n'))
    expect(result.summary.rows).toBe(201)
    expect(result.badRows[0].line).toBe(4)
  })

  it('lists at most 10 bad rows, but counts them all', () => {
    const result = parseItemList([...Array.from({ length: 12 }, (_, i) => row(`BAD${i}`, 'X', 'TAB')), ...validRows(1200)].join('\n'))
    expect(result.summary.badRows).toBe(12)
    expect(result.badRows).toHaveLength(10)
  })
})

describe('parseItemList refusals', () => {
  it('accepts exactly 1% bad rows and refuses more than 1%', () => {
    const atLimit = parseItemList([row('BAD01', 'X', 'TAB'), ...validRows(99)].join('\n'))
    expect(atLimit).toMatchObject({ ok: true, summary: { rows: 100, badRows: 1 } })

    const overLimit = parseItemList([row('BAD01', 'X', 'TAB'), row('BAD02', 'X', 'TAB'), ...validRows(98)].join('\n'))
    expect(overLimit).toMatchObject({ ok: false, summary: { rows: 100, items: 98, badRows: 2 } })
    expect(!overLimit.ok && overLimit.message).toBe('2 of 100 rows are not valid Item List rows (more than 1%).')
  })

  it('refuses the fixture with one more bad row', () => {
    const result = parseItemList(fixtureText + row('ZQ00', 'ANOTHER MISTYPED CODE', 'TAB') + '\n')
    expect(result).toMatchObject({ ok: false, summary: { rows: 121, badRows: 2 } })
  })

  it('refuses a file whose rows mostly have fewer than 15 columns: the wrong file', () => {
    const stockReport = ['Report Date: 19/10/2026 07:00:00', '', 'Cluster,Org Code,Subinventory,Item Code', 'KWC,NLT,PHARM,="PARA01"'].join('\r\n')
    const result = parseItemList(stockReport)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toBe('This does not look like an Item List (item_phq.txt): most rows have fewer than 15 tab-separated columns.')
  })

  it('refuses an empty file', () => {
    for (const text of ['', '\n\n', '\r\n  \r\n']) {
      const result = parseItemList(text)
      expect(result).toMatchObject({ ok: false, message: 'The file is empty.', summary: { rows: 0, items: 0 } })
    }
  })

  it('refuses a file with no valid rows', () => {
    const result = parseItemList(row('BAD01', 'X', 'TAB'))
    expect(result).toMatchObject({ ok: false, message: 'The file has no valid Item List rows.' })
  })
})

describe('lookupItem', () => {
  const items: ItemListEntry[] = [
    { itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' },
    { itemCode: 'PARA18', name: 'SYNTHETIC FICTAMOL ORAL SOLUTION', baseUnit: 'ML' },
    { itemCode: 'AIR 01', name: 'SYNTHETIC TEST GAS', baseUnit: 'CYN' }
  ]
  const index = indexItems(items)

  it('finds a listed Item Code', () => {
    expect(lookupItem(index, 'PARA18')).toEqual(items[1])
    expect(lookupItem(index, 'AIR 01')).toEqual(items[2])
  })

  it('upper-cases a–z first, as the label core does', () => {
    expect(lookupItem(index, 'para01')).toEqual(items[0])
    expect(lookupItem(index, 'air 01')).toEqual(items[2])
  })

  it('finds nothing for an unknown or malformed Item Code', () => {
    expect(lookupItem(index, 'PARA99')).toBeNull()
    expect(lookupItem(index, 'PARA0')).toBeNull()
    expect(lookupItem(index, ' PARA01')).toBeNull()
    expect(lookupItem(index, '')).toBeNull()
  })

  it('treats only base unit ML as a liquid', () => {
    expect(isLiquid(items[1])).toBe(true)
    expect(isLiquid(items[0])).toBe(false)
    expect(isLiquid({ baseUnit: 'BOTT' })).toBe(false)
  })
})

describe('itemListProblems: the Item List rules for a label', () => {
  const tablet: ItemListEntry = { itemCode: 'PARA01', name: 'SYNTHETIC TABLET', baseUnit: 'TAB' }
  const liquid: ItemListEntry = { itemCode: 'PARA18', name: 'SYNTHETIC SOLUTION', baseUnit: 'ML' }

  it('refuses an Item Code that is not in the Item List', () => {
    expect(itemListProblems(null, { itemCode: 'PARA99', packVolumeDigit: 0 })).toEqual([
      { field: 'itemCode', message: 'PARA99 is not in the Item List.' }
    ])
  })

  it('allows only Pack Volume digit 0 for an item that is not a liquid', () => {
    expect(itemListProblems(tablet, { itemCode: 'PARA01', packVolumeDigit: 0 })).toEqual([])
    for (const digit of [1, 2, 5]) {
      expect(itemListProblems(tablet, { itemCode: 'PARA01', packVolumeDigit: digit })).toEqual([
        { field: 'packVolume', message: 'PARA01 is not a liquid (base unit TAB), so it has no Pack Volume.' }
      ])
    }
  })

  it('allows Pack Volume digits 0–5 for a liquid (0 = Other)', () => {
    for (const digit of [0, 1, 2, 3, 4, 5]) {
      expect(itemListProblems(liquid, { itemCode: 'PARA18', packVolumeDigit: digit })).toEqual([])
    }
    for (const digit of [6, 9, -1, 1.5]) {
      expect(itemListProblems(liquid, { itemCode: 'PARA18', packVolumeDigit: digit })).toEqual([
        { field: 'packVolume', message: 'Choose a Pack Volume: 30, 60, 120, 240 or 480 mL, or Other.' }
      ])
    }
  })
})

describe('Item List summary text', () => {
  /** 9 Oct 2026 22:24 local time. */
  const modified = new Date(2026, 9, 9, 22, 24, 3)
  const info: ItemListInfo = {
    sourceFileName: 'item_phq.txt',
    sourceModified: modified.toISOString(),
    importedAt: new Date(2026, 9, 19, 9, 0).toISOString(),
    importedBy: 'chantm',
    pc: 'PHARM-01',
    items: 14312,
    liquids: 942
  }

  it('dates the file by its local calendar date, with an English month', () => {
    expect(formatFileDate(modified.toISOString())).toBe('09 Oct 2026')
    expect(formatFileDate(new Date(2027, 0, 1, 0, 0, 1).toISOString())).toBe('01 Jan 2027')
  })

  it('reads "14,312 items, 942 liquids, file dated 09 Oct 2026"', () => {
    expect(describeItemList(info)).toBe('14,312 items, 942 liquids, file dated 09 Oct 2026')
    expect(describeItemList({ ...info, items: 1, liquids: 0 })).toBe('1 item, 0 liquids, file dated 09 Oct 2026')
    expect(describeItemList({ ...info, items: 1_234_567, liquids: 1 })).toBe('1,234,567 items, 1 liquid, file dated 09 Oct 2026')
  })
})
