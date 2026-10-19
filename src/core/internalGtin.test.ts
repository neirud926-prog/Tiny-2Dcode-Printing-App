import { describe, expect, it } from 'vitest'
import {
  FIRST_RESERVED_ITEM_NUMBER,
  ITEM_CODE_CHARACTERS,
  PACK_VOLUMES,
  decodeInternalGtin,
  encodeInternalGtin,
  gs1CheckDigit,
  packVolumeDigitForMl,
  packVolumeMlForDigit
} from './internalGtin'

/** Appends a valid GS1 check digit, so a test can target one rule without tripping the check digit. */
function withCheckDigit(first13Digits: string): string {
  return first13Digits + String(gs1CheckDigit(first13Digits))
}

// ADR-0002 "Worked examples", verbatim.
const adrWorkedExamples = [
  { itemCode: 'PARA01', packVolumeDigit: 0, packVolumeMl: null, internalGtin: '00425873440010' },
  { itemCode: 'PARA18', packVolumeDigit: 0, packVolumeMl: null, internalGtin: '00425873440485' },
  { itemCode: 'PARA18', packVolumeDigit: 2, packVolumeMl: 60, internalGtin: '20425873440489' },
  { itemCode: 'AIR 01', packVolumeDigit: 0, packVolumeMl: null, internalGtin: '00410718656015' }
] as const

describe('gs1CheckDigit', () => {
  it('computes the GS1 mod-10 check digit', () => {
    expect(gs1CheckDigit('400638133393')).toBe(1) // GTIN-13 4006381333931
    expect(gs1CheckDigit('0042587344001')).toBe(0)
    expect(gs1CheckDigit('0042587344048')).toBe(5)
    expect(gs1CheckDigit('2042587344048')).toBe(9)
  })
})

describe('Pack Volume table (ADR-0002)', () => {
  it('maps each Pack Volume digit to its nominal volume in mL', () => {
    expect(PACK_VOLUMES).toEqual([
      { digit: 0, ml: null },
      { digit: 1, ml: 30 },
      { digit: 2, ml: 60 },
      { digit: 3, ml: 120 },
      { digit: 4, ml: 240 },
      { digit: 5, ml: 480 }
    ])
  })

  it('looks up the digit for a listed volume, and 0 for none or an unlisted volume', () => {
    expect(packVolumeDigitForMl(30)).toBe(1)
    expect(packVolumeDigitForMl(60)).toBe(2)
    expect(packVolumeDigitForMl(120)).toBe(3)
    expect(packVolumeDigitForMl(240)).toBe(4)
    expect(packVolumeDigitForMl(480)).toBe(5)
    expect(packVolumeDigitForMl(null)).toBe(0)
    expect(packVolumeDigitForMl(100)).toBe(0)
    expect(packVolumeDigitForMl(500)).toBe(0)
  })

  it('looks up the volume for a digit', () => {
    expect(packVolumeMlForDigit(0)).toBeNull()
    expect(packVolumeMlForDigit(2)).toBe(60)
    expect(packVolumeMlForDigit(5)).toBe(480)
  })
})

describe('encodeInternalGtin', () => {
  it.each(adrWorkedExamples)(
    'encodes ADR-0002 example $itemCode, Pack Volume digit $packVolumeDigit → $internalGtin',
    ({ itemCode, packVolumeDigit, internalGtin }) => {
      expect(encodeInternalGtin(itemCode, packVolumeDigit)).toEqual({
        ok: true,
        internalGtin,
        itemCode,
        packVolumeDigit
      })
    }
  )

  it('encodes the smallest and largest Item Codes', () => {
    expect(encodeInternalGtin('000000', 0)).toMatchObject({ ok: true, internalGtin: '00400000000008' })
    expect(encodeInternalGtin('......', 0)).toMatchObject({ ok: true, internalGtin: '00440959999992' })
  })

  it('puts the Pack Volume digit first and recomputes the check digit', () => {
    for (const { digit } of PACK_VOLUMES) {
      const result = encodeInternalGtin('PARA18', digit)
      expect(result).toMatchObject({ ok: true, internalGtin: withCheckDigit(`${digit}042587344048`) })
    }
  })

  it('upper-cases lower case Item Codes', () => {
    expect(encodeInternalGtin('para01', 0)).toEqual(encodeInternalGtin('PARA01', 0))
    expect(encodeInternalGtin('Para18', 2)).toMatchObject({
      ok: true,
      itemCode: 'PARA18',
      internalGtin: '20425873440489'
    })
    expect(encodeInternalGtin('air 01', 0)).toMatchObject({ ok: true, itemCode: 'AIR 01' })
  })

  it.each(['', 'PARA1', 'AIR01', 'PARA011', 'PARA01 '])('refuses Item Code %j: wrong length', (itemCode) => {
    expect(encodeInternalGtin(itemCode, 0)).toMatchObject({ ok: false, reason: 'item-code-length' })
  })

  it.each([
    'PARA0!',
    'PARA_1',
    'PARA,1',
    'PARA"1',
    'PARA\t1',
    'PARAé1',
    'PARA01'.replace('A', 'Ａ'), // full-width A
    'ıTEM01', // dotless i upper-cases to I in JavaScript; it must be refused, not turned into I
    'ſTEM01' // long s upper-cases to S in JavaScript
  ])('refuses Item Code %j: character outside the 40', (itemCode) => {
    expect(encodeInternalGtin(itemCode, 0)).toMatchObject({ ok: false, reason: 'item-code-character' })
  })

  it.each([6, 7, 8, 9, -1, 10, 1.5, Number.NaN])('refuses Pack Volume digit %s', (packVolumeDigit) => {
    expect(encodeInternalGtin('PARA01', packVolumeDigit)).toMatchObject({
      ok: false,
      reason: 'pack-volume-digit'
    })
  })

  it('explains a refusal in words', () => {
    const result = encodeInternalGtin('PARA1', 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/Item Code/)
  })
})

describe('decodeInternalGtin', () => {
  it.each(adrWorkedExamples)(
    'decodes ADR-0002 example $internalGtin → $itemCode, Pack Volume digit $packVolumeDigit',
    ({ itemCode, packVolumeDigit, packVolumeMl, internalGtin }) => {
      expect(decodeInternalGtin(internalGtin)).toEqual({ ok: true, itemCode, packVolumeDigit, packVolumeMl })
    }
  )

  it('decodes the boundary values', () => {
    expect(decodeInternalGtin('00400000000008')).toMatchObject({ ok: true, itemCode: '000000' })
    expect(decodeInternalGtin('00440959999992')).toMatchObject({ ok: true, itemCode: '......' })
  })

  it('decodes the existing gtins entry the ADR checked, to a code that is not an Item Code', () => {
    expect(decodeInternalGtin('00402816304400')).toMatchObject({ ok: true, itemCode: '2U0J10' })
  })

  it('round-trips every character in every position', () => {
    for (let position = 0; position < 6; position++) {
      for (const character of ITEM_CODE_CHARACTERS) {
        const itemCode = 'PARA01'.slice(0, position) + character + 'PARA01'.slice(position + 1)
        const encoded = encodeInternalGtin(itemCode, 3)
        if (!encoded.ok) throw new Error(`${itemCode}: ${encoded.message}`)
        expect(decodeInternalGtin(encoded.internalGtin)).toEqual({
          ok: true,
          itemCode,
          packVolumeDigit: 3,
          packVolumeMl: 120
        })
      }
    }
  })

  it.each(['', '0042587344001', '004258734400100', '0042587344001A', ' 00425873440010', '00425873440010\n'])(
    'refuses %j: not 14 digits',
    (gtin) => {
      expect(decodeInternalGtin(gtin)).toMatchObject({ ok: false, reason: 'not-14-digits' })
    }
  )

  it('refuses a bad check digit', () => {
    expect(decodeInternalGtin('00425873440011')).toMatchObject({ ok: false, reason: 'check-digit' })
    expect(decodeInternalGtin('20425873440485')).toMatchObject({ ok: false, reason: 'check-digit' })
  })

  it.each(['0', '1', '2', '3', '5', '9'])('refuses digits 2–3 = "0%s" (not 04)', (digit3) => {
    const gtin = withCheckDigit(`00${digit3}2587344001`)
    expect(decodeInternalGtin(gtin)).toMatchObject({ ok: false, reason: 'prefix' })
  })

  it('refuses digits 2–3 = "14" (not 04)', () => {
    expect(decodeInternalGtin(withCheckDigit('0142587344001'))).toMatchObject({ ok: false, reason: 'prefix' })
  })

  it.each(['6', '7', '8', '9'])('refuses Pack Volume digit %s', (digit) => {
    const gtin = withCheckDigit(`${digit}042587344001`)
    expect(decodeInternalGtin(gtin)).toMatchObject({ ok: false, reason: 'pack-volume-digit' })
  })

  it('refuses N in the range reserved for a future version', () => {
    expect(FIRST_RESERVED_ITEM_NUMBER).toBe(4_096_000_000)
    for (const n of ['4096000000', '4096000001', '5000000000', '9999999999']) {
      const gtin = withCheckDigit(`004${n}`)
      expect(decodeInternalGtin(gtin)).toMatchObject({ ok: false, reason: 'reserved-range' })
    }
    expect(decodeInternalGtin(withCheckDigit('0044095999999'))).toMatchObject({ ok: true })
  })
})
