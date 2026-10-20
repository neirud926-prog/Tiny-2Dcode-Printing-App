import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { toBuffer } from 'bwip-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { buildLabel, decodeLabelData, type LabelRequest } from '../core/label'
import { DOT_MM, MODULE_MM, dataMatrixOptions, renderDataMatrix } from './dataMatrix'

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
  it('is exactly 4 printer dots at 203 dpi', () => {
    expect(DOT_MM).toBeCloseTo(25.4 / 203, 12)
    expect(MODULE_MM).toBeCloseTo((4 * 25.4) / 203, 12)
    expect(MODULE_MM).toBeCloseTo(0.5005, 4)
  })

  it('is 1 cm square for a typical label', () => {
    const symbol = renderDataMatrix(labelFor({}))
    expect(symbol.widthMm).toBeCloseTo(10, 1)
    expect(symbol.heightMm).toBeCloseTo(10, 1)
  })

  it('is never smaller than 20 × 20 modules (1 cm), even for a short Lot', () => {
    const symbol = renderDataMatrix(labelFor({ lot: 'A1' }))
    expect(symbol.columns).toBe(20)
    expect(symbol.widthMm).toBeCloseTo(10, 1)
  })

  it('sizes the symbol as modules × module size', () => {
    const symbol = renderDataMatrix(labelFor({}))
    expect(symbol.columns).toBe(20)
    expect(symbol.rows).toBe(20)
    expect(symbol.widthMm).toBeCloseTo(20 * MODULE_MM, 12)
    expect(symbol.heightMm).toBeCloseTo(20 * MODULE_MM, 12)
  })

  it('grows to 22 × 22 modules (≈ 11 mm) only for a Lot too long for 1 cm, up to 20 characters', () => {
    for (const lot of ['ABCDEFGHIJ0123456789', '99999999999999999999', 'WWWWWWWWWWWWWWWWWWWW', '(((((((((())))))))))']) {
      const symbol = renderDataMatrix(labelFor({ lot }))
      expect(symbol.columns).toBe(22)
      expect(symbol.widthMm).toBeLessThan(11.1)
    }
  })

  it('returns SVG markup and the viewBox to scale it by', () => {
    const symbol = renderDataMatrix(labelFor({}))
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
})
