import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expiryEntryOf, formatQuantity, lotChoices, lotPicker, type LotChoice } from './lotPicker'
import { indexStockLots, parseStockOnhand, stockLotsFor, type StockLot, type StockOnhandInfo } from './stockOnhand'

const fixture = parseStockOnhand(readFileSync(join(__dirname, '../../test-fixtures/stock-onhand-synthetic.ps'), 'latin1'))
if (!fixture.ok) throw new Error(fixture.message)
const index = indexStockLots(fixture.lots)

/** The fixture's Report Date. */
const TODAY = '2026-10-19'

const info: StockOnhandInfo = {
  sourceFileName: 'stock-onhand-synthetic.ps',
  sourceModified: '2026-10-19T08:30:00.000Z',
  importedAt: '2026-10-19T09:00:00.000Z',
  importedBy: 'chantm',
  pc: 'PHARM-01',
  reportDate: TODAY,
  reportTime: '16:22:43',
  organizationCode: 'NL0',
  subinventoryCode: 'NL0-S-MAIN',
  items: 104,
  lots: 118
}

function lot(lotNumber: string, expiry: string | null, quantity = 10, uom = 'TAB'): StockLot {
  return { itemCode: 'ZT0001', lot: lotNumber, expiry, uom, quantity }
}

describe('lotChoices: the Lots of PARA01 in the fixture', () => {
  const choices = lotChoices(stockLotsFor(index, 'PARA01'), TODAY)

  it('lists every Lot, earliest Expiry first, with Expiry as dd MMM yyyy and quantity with UOM', () => {
    expect(choices.map((choice) => [choice.lot, choice.expiryText, choice.quantityText])).toEqual([
      ['X0PAST1', '30 SEP 2026', '20 TAB'],
      ['L/2026/07', '31 DEC 2026', '200 TAB'],
      ['2605261', '25 MAY 2027', '1,500 TAB'],
      ['AB 123', '01 MAR 2028', '50 TAB']
    ])
  })

  it('fills Lot and Expiry exactly as recorded (Expiry as the 8-digit ddmmyyyy entry)', () => {
    expect(byLot(choices, '2605261')).toEqual({
      lot: '2605261',
      expiryText: '25 MAY 2027',
      quantityText: '1,500 TAB',
      status: 'ok',
      message: null,
      fill: { lot: '2605261', expiry: '25052027' }
    })
    expect(byLot(choices, 'L/2026/07').fill).toEqual({ lot: 'L/2026/07', expiry: '31122026' })
  })

  it('warns about a short expiry but lets it be picked', () => {
    expect(byLot(choices, 'L/2026/07')).toMatchObject({ status: 'warning', message: 'Short expiry: less than 3 months away (before 19 JAN 2027).' })
  })

  it('blocks an Expiry that has passed', () => {
    expect(byLot(choices, 'X0PAST1')).toMatchObject({ status: 'blocked', message: 'This Expiry (30 SEP 2026) has already passed.', fill: null })
  })

  it('disables a Lot the Lot rules refuse, with the reason', () => {
    expect(byLot(choices, 'AB 123')).toMatchObject({ status: 'invalid', message: 'GS1 cannot encode a space in a Lot.', fill: null })
  })
})

describe('lotChoices rules', () => {
  it('disables a Lot with no Expiry, listing it last', () => {
    const choices = lotChoices([lot('NOEXP', null), lot('L1', '280101')], TODAY)
    expect(choices.map((choice) => choice.lot)).toEqual(['L1', 'NOEXP'])
    expect(choices[1]).toMatchObject({ status: 'invalid', message: 'The Stock Onhand has no Expiry for this Lot.', expiryText: null, fill: null })
  })

  it('upper-cases a lower-case Lot, as the Lot rules do for a typed one', () => {
    expect(lotChoices([lot('ab12', '280101')], TODAY)[0]).toMatchObject({ status: 'ok', fill: { lot: 'AB12', expiry: '01012028' } })
  })

  it('refuses a Lot longer than 20 characters or with other characters', () => {
    const choices = lotChoices([lot('A'.repeat(21), '280101'), lot('A.B', '280102')], TODAY)
    expect(choices.map((choice) => [choice.status, choice.message])).toEqual([
      ['invalid', 'A Lot can have at most 20 characters; this one has 21.'],
      ['invalid', 'A Lot cannot contain "."; only A–Z, 0–9, "-", "/", "(" and ")" are allowed.']
    ])
  })

  it('sorts equal Expiries by Lot', () => {
    expect(lotChoices([lot('L2', '280101'), lot('L10', '280101'), lot('A', '290101')], TODAY).map((choice) => choice.lot)).toEqual(['L10', 'L2', 'A'])
  })

  it('judges Expiry against the day given', () => {
    expect(lotChoices([lot('L1', '261231')], '2026-09-01')[0].status).toBe('ok')
    expect(lotChoices([lot('L1', '261231')], '2027-01-01')[0].status).toBe('blocked')
  })
})

describe('lotPicker', () => {
  it('offers the Lots of an item in today’s Stock Onhand', () => {
    const picker = lotPicker(info, 'PARA18', stockLotsFor(index, 'PARA18'), TODAY)
    expect(picker.status).toBe('choices')
    expect(picker.status === 'choices' && picker.choices.map((choice) => choice.lot)).toEqual(['P18B002', 'P18A001'])
    expect(picker.status === 'choices' && picker.choices[0].quantityText).toBe('1,200 ML')
  })

  it('shows the stale message instead of Lots from another day', () => {
    expect(lotPicker(info, 'PARA18', stockLotsFor(index, 'PARA18'), '2026-10-20')).toEqual({
      status: 'stale',
      message: "Stock Onhand is dated 19 Oct 2026. Import today's file to pick a Lot."
    })
  })

  it('says when there is no Stock Onhand, or no Lots of the item in it', () => {
    expect(lotPicker(null, 'PARA18', [], TODAY)).toEqual({ status: 'none', message: 'No Stock Onhand for today: type the Lot and Expiry.' })
    expect(lotPicker(info, 'BAG Z9', stockLotsFor(index, 'BAG Z9'), TODAY)).toEqual({
      status: 'no-lots',
      message: 'BAG Z9 has no Lots in today’s Stock Onhand: type the Lot and Expiry.'
    })
  })
})

describe('expiryEntryOf and formatQuantity', () => {
  it('turns YYMMDD into the ddmmyyyy entry', () => {
    expect(expiryEntryOf('270525')).toBe('25052027')
    expect(expiryEntryOf('000101')).toBe('01012000')
    expect(expiryEntryOf('270230')).toBeNull()
    expect(expiryEntryOf('2705')).toBeNull()
  })

  it('groups digits with commas and keeps decimals', () => {
    expect(formatQuantity(0)).toBe('0')
    expect(formatQuantity(1500)).toBe('1,500')
    expect(formatQuantity(1234567.25)).toBe('1,234,567.25')
    expect(formatQuantity(0.5)).toBe('0.5')
    expect(formatQuantity(-1200)).toBe('-1,200')
  })
})

function byLot(choices: readonly LotChoice[], lotNumber: string): LotChoice {
  const choice = choices.find((entry) => entry.lot === lotNumber)
  if (!choice) throw new Error(`no Lot ${lotNumber}`)
  return choice
}
