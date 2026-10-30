import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { toBuffer } from 'bwip-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { buildLabel, decodeLabelData, type LabelRequest } from '../core/label'
import { DOT_MM, MODULE_MM, dataMatrixOptions, MODULE_DOTS, plainCodeOptions, renderDataMatrix, renderPlainCode } from './dataMatrix'

const today = '2026-10-19'

function labelFor(overrides: Partial<LabelRequest>) {
  const result = buildLabel(
    { itemCode: 'PARA01', packVolumeDigit: 0, expiry: '31122027', lot: '2512172-1', copies: 1, ...overrides },
    { today }
  )
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.label
}

describe('module size', () => {
  it('is whole printer dots at each Printer resolution: 203 dpi 3 / 4 / 5, 300 dpi 4 / 6 / 7, 360 dpi 5 / 7 / 9', () => {
    expect(MODULE_DOTS).toEqual({ 203: { small: 3, medium: 4, large: 5 }, 300: { small: 4, medium: 6, large: 7 }, 360: { small: 5, medium: 7, large: 9 } })
    // A 26 × 26 Plain DataMatrix: Large at 360 dpi is 26 × 9 dots = 16.51 mm.
    expect(renderPlainCode('datamatrix', 'a', 'large', 360).widthMm).toBeCloseTo((26 * 9 * 25.4) / 360, 12)
    expect(renderPlainCode('datamatrix', 'a', 'medium', 300).widthMm).toBeCloseTo((26 * 6 * 25.4) / 300, 12)
  })

  it('is Medium for a GTIN Label: 7 dots at 360 dpi, still about 1 cm', () => {
    const symbol = renderDataMatrix(labelFor({}), 360)
    expect(symbol.widthMm).toBeCloseTo((20 * 7 * 25.4) / 360, 12)
    expect(symbol.widthMm).toBeCloseTo(9.878, 3)
  })

  it('is exactly 4 printer dots at 203 dpi', () => {
    expect(DOT_MM).toBeCloseTo(25.4 / 203, 12)
    expect(MODULE_MM).toBeCloseTo((4 * 25.4) / 203, 12)
    expect(MODULE_MM).toBeCloseTo(0.5005, 4)
  })

  it('is 1 cm square for a typical label', () => {
    const symbol = renderDataMatrix(labelFor({}), 203)
    expect(symbol.widthMm).toBeCloseTo(10, 1)
    expect(symbol.heightMm).toBeCloseTo(10, 1)
  })

  it('is never smaller than 20 × 20 modules (1 cm), even for a short Lot', () => {
    const symbol = renderDataMatrix(labelFor({ lot: 'A1' }), 203)
    expect(symbol.columns).toBe(20)
    expect(symbol.widthMm).toBeCloseTo(10, 1)
  })

  it('sizes the symbol as modules × module size', () => {
    const symbol = renderDataMatrix(labelFor({}), 203)
    expect(symbol.columns).toBe(20)
    expect(symbol.rows).toBe(20)
    expect(symbol.widthMm).toBeCloseTo(20 * MODULE_MM, 12)
    expect(symbol.heightMm).toBeCloseTo(20 * MODULE_MM, 12)
  })

  it('grows to 22 × 22 modules (≈ 11 mm) only for a Lot too long for 1 cm, up to 20 characters', () => {
    for (const lot of ['ABCDEFGHIJ0123456789', '99999999999999999999', 'WWWWWWWWWWWWWWWWWWWW', '(((((((((())))))))))']) {
      const symbol = renderDataMatrix(labelFor({ lot }), 203)
      expect(symbol.columns).toBe(22)
      expect(symbol.widthMm).toBeLessThan(11.1)
    }
  })

  it('returns SVG markup and the viewBox to scale it by', () => {
    const symbol = renderDataMatrix(labelFor({}), 203)
    expect(symbol.viewBox).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/)
    expect(symbol.markup).toMatch(/^<path /)
    expect(symbol.markup).not.toContain('<svg')
  })
})

describe('dataMatrixOptions', () => {
  it('feeds bwip-js the bracketed form', () => {
    expect(dataMatrixOptions(labelFor({}))).toEqual({
      bcid: 'gs1datamatrix',
      text: '(01)00425873440010(17)271231(10)2512172-1',
      parse: true
    })
  })

  it('writes parentheses inside the Lot as ordinals, so they are not read as AIs', () => {
    expect(dataMatrixOptions(labelFor({ lot: '(B)A52921725A4' })).text).toBe(
      '(01)00425873440010(17)271231(10)^040B^041A52921725A4'
    )
  })
})

describe('render round-trip: the printed symbol decodes to the label data', () => {
  beforeAll(async () => {
    // Load the reader from node_modules rather than the CDN zxing-wasm uses by default: tests run offline.
    const wasmPath = createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm')
    const wasm = readFileSync(wasmPath)
    await prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
      fireImmediately: true
    })
  })

  /** Element string as a scanner transmits it: drop the symbology identifier and any leading/trailing GS. */
  function normalise(text: string): string {
    return text.replace(/^\]d2/, '').replace(/^\u001d/, '').replace(/\u001d$/, '')
  }

  it.each([
    ['a typical Lot', { lot: '2512172-1' }],
    ['a 20-character Lot', { lot: 'ABCDEFGHIJ0123456789' }],
    ['a 20-character Lot of one repeated letter', { lot: 'WWWWWWWWWWWWWWWWWWWW' }],
    ['a Lot with slashes', { lot: 'MIPL/A4/UII/91' }],
    ['a Lot with parentheses', { lot: '(B)A52921725A4' }],
    ['a Lot that looks like AIs', { lot: '1017(01)' }],
    ['a Pack Volume and an Item Code with a space', { itemCode: 'AIR 01', packVolumeDigit: 5, lot: '21113HK1' }],
    ['a month-only Expiry', { expiry: '01122027' }]
  ])('%s', async (_case, overrides: Partial<LabelRequest>) => {
    const label = labelFor(overrides)
    const png = await toBuffer({ ...dataMatrixOptions(label), scale: 4, padding: 4, backgroundcolor: 'FFFFFF' })

    const results = await readBarcodes(new Uint8Array(png), { formats: ['DataMatrix'], textMode: 'Plain' })

    expect(results).toHaveLength(1)
    const [result] = results
    expect(result.symbologyIdentifier).toBe(']d2') // GS1 DataMatrix: FNC1 in first position
    expect(normalise(result.text)).toBe(label.elementString)
    expect(decodeLabelData(normalise(result.text))).toMatchObject({
      ok: true,
      data: { internalGtin: label.internalGtin, itemCode: label.itemCode, expiryText: label.expiryText, lot: label.lot }
    })
  })

  describe('plain codes: the printed DataMatrix or QR holds exactly the typed data', () => {
    const values = ['SHELF-1C5A', 'a', 'Bin 4 # (top) + 2*3', 'ABCDEFGHIJabcdefghij0123456789 -_./:#()+', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']

    it.each(values.flatMap((value) => [['DataMatrix', 'datamatrix', value] as const, ['QRCode', 'qr', value] as const]))(
      '%s holds %j',
      async (format, symbology, value) => {
        const png = await toBuffer({ ...plainCodeOptions(symbology, value), scale: 4, padding: 8, backgroundcolor: 'FFFFFF' })
        const results = await readBarcodes(new Uint8Array(png), { formats: [format], textMode: 'Plain' })
        expect(results).toHaveLength(1)
        expect(results[0].symbologyIdentifier).toBe(symbology === 'qr' ? ']Q1' : ']d1') // plain: no GS1 FNC1
        expect(results[0].text).toBe(value)
      }
    )

    it('are always the size that holds 40 characters (DataMatrix 26 × 26, QR version 3, 29 × 29), on whole printer dots', () => {
      for (const value of ['a', values[3], values[4]]) {
        const dm = renderPlainCode('datamatrix', value, 'small', 203)
        expect([dm.columns, dm.rows]).toEqual([26, 26])
        expect(dm.widthMm).toBeCloseTo(26 * 3 * DOT_MM, 12)
        expect(dm.quietZoneMm).toBeCloseTo(3 * DOT_MM, 12)
        const qr = renderPlainCode('qr', value, 'large', 203)
        expect([qr.columns, qr.rows]).toEqual([29, 29])
        expect(qr.widthMm).toBeCloseTo(29 * 5 * DOT_MM, 12)
        expect(qr.quietZoneMm).toBeCloseTo(4 * 5 * DOT_MM, 12)
      }
    })
  })
})
