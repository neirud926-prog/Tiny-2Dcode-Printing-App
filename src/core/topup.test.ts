import { describe, expect, it } from 'vitest'
import { indexTopup, lookupTopup, parseTopupDatabase, topupContent } from './topup'

const header = { number: 1, cells: ['Item Code', 'Item Description', 'Display Name (MOE)', 'Salt / Special Property (MOE)', 'Form Code'] }

/** `count` good rows from row 2, Item Codes T00001, T00002, … */
function goodRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ number: index + 2, cells: [`T${String(index + 1).padStart(5, '0')}`, 'DESC', 'NAME', '', 'TAB'] }))
}

describe('parseTopupDatabase', () => {
  it('finds the four columns by name in any order, keeping cells exactly as written', () => {
    const parsed = parseTopupDatabase([
      { number: 1, cells: ['Form Code', ' item code ', 'Notes', 'SALT / SPECIAL PROPERTY (MOE)', 'Display Name (MOE)'] },
      { number: 2, cells: ['TAB', 'FICT01', 'x', '', ' FICTAMOL  '] },
      { number: 4, cells: ['CYN', 'GAS 01', '', 'A & B'] }
    ])
    expect(parsed).toEqual({
      ok: true,
      entries: [
        { itemCode: 'FICT01', displayName: ' FICTAMOL  ', salt: '', formCode: 'TAB' },
        { itemCode: 'GAS 01', displayName: '', salt: 'A & B', formCode: 'CYN' }
      ],
      summary: { rows: 2, entries: 2, badRows: 0, duplicates: 0 },
      badRows: []
    })
  })

  it('keeps the first row of a repeated Item Code', () => {
    const parsed = parseTopupDatabase([header, ...goodRows(2), { number: 4, cells: ['T00001', '', 'OTHER', '', 'INJ'] }])
    expect(parsed).toMatchObject({ ok: true, summary: { rows: 3, entries: 2, duplicates: 1 } })
    expect(parsed.ok && parsed.entries[0].displayName).toBe('NAME')
  })

  it('skips up to 1% of rows whose Item Code is not 6 characters, listing them', () => {
    const parsed = parseTopupDatabase([header, ...goodRows(99), { number: 101, cells: ['T0001', '', 'NAME', '', 'TAB'] }])
    expect(parsed).toMatchObject({
      ok: true,
      summary: { rows: 100, entries: 99, badRows: 1 },
      badRows: [{ line: 101, message: 'Row 101: the Item Code "T0001" is not 6 characters.' }]
    })
  })

  it('refuses more than 1% bad rows', () => {
    const parsed = parseTopupDatabase([header, ...goodRows(98), { number: 100, cells: ['', '', 'NAME'] }, { number: 101, cells: ['T0000001'] }])
    expect(parsed).toMatchObject({ ok: false, message: '2 of 100 rows are not valid Topup Database rows (more than 1%).' })
  })

  it('refuses a sheet without one of the four columns, naming those missing', () => {
    expect(parseTopupDatabase([{ number: 1, cells: ['Item Code', 'Display Name'] }, ...goodRows(1)])).toMatchObject({
      ok: false,
      message: 'The DataBase sheet has no column "Display Name (MOE)", "Salt / Special Property (MOE)", "Form Code".'
    })
    expect(parseTopupDatabase([])).toMatchObject({ ok: false, message: 'The DataBase sheet has no column "Item Code", "Display Name (MOE)", "Salt / Special Property (MOE)", "Form Code".' })
  })

  it('refuses a sheet with no rows under its headings', () => {
    expect(parseTopupDatabase([header])).toEqual({
      ok: false,
      message: 'The DataBase sheet has no rows.',
      summary: { rows: 0, entries: 0, badRows: 0, duplicates: 0 },
      badRows: []
    })
  })
})

describe('lookupTopup', () => {
  it('finds an entry by Item Code, a–z upper-cased, spaces kept', () => {
    const index = indexTopup([
      { itemCode: 'FICT01', displayName: 'FICTAMOL', salt: '', formCode: 'TAB' },
      { itemCode: 'GAS 01', displayName: 'GAS', salt: '', formCode: 'CYN' }
    ])
    expect(lookupTopup(index, 'fict01')?.displayName).toBe('FICTAMOL')
    expect(lookupTopup(index, 'gas 01')?.itemCode).toBe('GAS 01')
    expect(lookupTopup(index, 'GAS01')).toBeNull()
  })

  it('finds an Item Code written in lower case in the DataBase sheet, keeping it as written', () => {
    const index = indexTopup([{ itemCode: 'lowc01', displayName: 'LOWER', salt: '', formCode: 'TAB' }])
    expect(lookupTopup(index, 'LOWC01')?.itemCode).toBe('lowc01')
    expect(lookupTopup(index, 'lowc01')?.itemCode).toBe('lowc01')
  })

  it('upper-cases only a–z, so a dotless ı does not match I', () => {
    const index = indexTopup([{ itemCode: 'FIXI01', displayName: 'FIXI', salt: '', formCode: 'TAB' }])
    expect(lookupTopup(index, 'fıxı01')).toBeNull()
  })
})

describe('topupContent', () => {
  it("is the workbook's column B: display name, salt, form code and Item Code in the <drug> format", () => {
    expect(topupContent({ itemCode: 'FICT01', displayName: 'FICTAMOL', salt: 'SODIUM', formCode: 'TAB' })).toBe(
      '<drug S="1"><a>FICTAMOL</a><b>SODIUM</b><c></c><d>TAB</d><e></e><f>FICT01</f><G></G><H></H><I></I><J></J></drug>'
    )
  })

  it('keeps & and < as they are and leaves an empty salt empty, as the workbook does', () => {
    expect(topupContent({ itemCode: 'GAS 01', displayName: 'SYNTH GAS (DISSOLVED & <TEST>)', salt: '', formCode: 'CYN' })).toBe(
      '<drug S="1"><a>SYNTH GAS (DISSOLVED & <TEST>)</a><b></b><c></c><d>CYN</d><e></e><f>GAS 01</f><G></G><H></H><I></I><J></J></drug>'
    )
  })
})
