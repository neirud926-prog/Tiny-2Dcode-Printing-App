import { describe, expect, it } from 'vitest'
import { buildLabel, type LabelRequest } from '../core/label'
import { DOT_MM, MODULE_MM } from './dataMatrix'
import {
  DEFAULT_LABEL_SIZE,
  LOT_OWN_LINE_AFTER,
  SIDE_PADDING_MM,
  SYMBOL_TEXT_GAP_MM,
  layoutLabel,
  renderLabelSvg,
  type LabelLayout
} from './labelSvg'

const today = '2026-10-19'

function labelFor(overrides: Partial<LabelRequest> = {}) {
  const result = buildLabel(
    { itemCode: 'PARA01', packVolumeDigit: 0, expiry: '31122027', lot: '2512172-1', copies: 1, ...overrides },
    { today }
  )
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.label
}

/** Every text line of a layout. */
function linesOf(layout: LabelLayout) {
  return [layout.itemCodeLine, layout.expiryLine, layout.lotLine]
}

function isOnDotGrid(mm: number): boolean {
  const dots = mm / DOT_MM
  return Math.abs(dots - Math.round(dots)) < 1e-9
}

describe('layoutLabel', () => {
  it('defaults to a 34.4 × 25 mm label', () => {
    expect(DEFAULT_LABEL_SIZE).toEqual({ widthMm: 34.4, heightMm: 25 })
    expect(layoutLabel(labelFor()).size).toEqual(DEFAULT_LABEL_SIZE)
  })

  it('puts the symbol on the left, 1.5 mm in, on the printer dot grid, 4 dots per module', () => {
    const { symbol } = layoutLabel(labelFor())
    expect(SIDE_PADDING_MM).toBe(1.5)
    expect(symbol.xMm).toBeCloseTo(1.5, 1)
    expect(isOnDotGrid(symbol.xMm)).toBe(true)
    expect(isOnDotGrid(symbol.yMm)).toBe(true)
    expect(symbol.widthMm).toBeCloseTo(symbol.columns * MODULE_MM, 12)
  })

  it('sets Item Code, EXP and LOT beside the symbol, 1.2 mm from it', () => {
    const layout = layoutLabel(labelFor())
    const textX = layout.symbol.xMm + layout.symbol.widthMm + SYMBOL_TEXT_GAP_MM
    expect(SYMBOL_TEXT_GAP_MM).toBe(1.2)
    for (const line of linesOf(layout)) expect(line.xMm).toBeCloseTo(textX, 9)
    expect(layout.itemCodeLine.baselineMm).toBeLessThan(layout.expiryLine.baselineMm)
    expect(layout.expiryLine.baselineMm).toBeLessThan(layout.lotLine.baselineMm)
  })

  it('sets Item Code and Pack Volume bold 6.5 pt, the same as EXP and LOT, with bold labels', () => {
    const layout = layoutLabel(labelFor({ itemCode: 'PARA18', packVolumeDigit: 2 }))
    expect(layout.itemCodeLine.runs).toEqual([
      { text: 'PARA18', fontSizePt: 6.5, bold: true, gapBeforeMm: 0 },
      { text: '60 mL', fontSizePt: 6.5, bold: true, gapBeforeMm: expect.any(Number) }
    ])
    expect(layout.expiryLine.runs).toEqual([
      { text: 'EXP', fontSizePt: 6.5, bold: true, gapBeforeMm: 0 },
      { text: ' 31 DEC 2027', fontSizePt: 6.5, bold: false, gapBeforeMm: 0 }
    ])
    expect(layout.lotLine.runs).toEqual([
      { text: 'LOT', fontSizePt: 6.5, bold: true, gapBeforeMm: 0 },
      { text: ' 2512172-1', fontSizePt: 6.5, bold: false, gapBeforeMm: 0 }
    ])
  })

  it('shows no Pack Volume when none is encoded', () => {
    expect(layoutLabel(labelFor()).itemCodeLine.runs.map((run) => run.text)).toEqual(['PARA01'])
  })

  it(`keeps a Lot of ${LOT_OWN_LINE_AFTER} characters beside the symbol`, () => {
    expect(LOT_OWN_LINE_AFTER).toBe(15)
    const layout = layoutLabel(labelFor({ lot: '123456789012345' }))
    expect(layout.lotOnOwnLine).toBe(false)
    expect(layout.lotLine.xMm).toBe(layout.expiryLine.xMm)
  })

  it('moves a Lot longer than 15 characters to its own full-width line under the symbol', () => {
    const layout = layoutLabel(labelFor({ lot: '1234567890123456' }))
    expect(layout.lotOnOwnLine).toBe(true)
    expect(layout.lotLine.xMm).toBe(SIDE_PADDING_MM)
    expect(layout.lotLine.maxWidthMm).toBeCloseTo(DEFAULT_LABEL_SIZE.widthMm - 2 * SIDE_PADDING_MM, 9)
    // Clear of the symbol by at least one module (the DataMatrix quiet zone).
    expect(layout.lotLine.topMm).toBeGreaterThanOrEqual(layout.symbol.yMm + layout.symbol.heightMm + MODULE_MM)
  })

  it.each([
    ['a short Lot', {}],
    ['a Lot on its own line', { lot: 'ABCDEFGHIJ0123456789' }]
  ])('centres the content vertically (%s)', (_case, overrides: Partial<LabelRequest>) => {
    const layout = layoutLabel(labelFor(overrides))
    const above = layout.content.topMm
    const below = layout.size.heightMm - layout.content.bottomMm
    expect(Math.abs(above - below)).toBeLessThanOrEqual(DOT_MM)
    expect(layout.content.topMm).toBeLessThanOrEqual(layout.symbol.yMm)
    expect(layout.content.bottomMm).toBeGreaterThanOrEqual(layout.symbol.yMm + layout.symbol.heightMm)
  })

  it('does not squeeze the text of a typical label', () => {
    for (const line of linesOf(layoutLabel(labelFor()))) expect(line.scaleX).toBe(1)
  })

  it.each([
    ['the widest Item Code with the longest Pack Volume', { itemCode: 'WWWWWW', packVolumeDigit: 5 }],
    ['the widest 15-character Lot', { lot: 'WWWWWWWWWWWWWWW' }],
    ['the widest 20-character Lot', { lot: 'WWWWWWWWWWWWWWWWWWWW' }],
    ['a 15-digit Lot', { lot: '251217212345678' }]
  ])('squeezes text that would run off the label: %s', (_case, overrides: Partial<LabelRequest>) => {
    const layout = layoutLabel(labelFor(overrides))
    for (const line of linesOf(layout)) {
      expect(line.widthMm * line.scaleX).toBeLessThanOrEqual(line.maxWidthMm + 1e-9)
      expect(line.xMm + line.maxWidthMm).toBeLessThanOrEqual(layout.size.widthMm - SIDE_PADDING_MM + 1e-9)
    }
    expect(linesOf(layout).some((line) => line.scaleX < 1)).toBe(true)
  })

  it('lays out any label size it is given', () => {
    const layout = layoutLabel(labelFor(), { widthMm: 50, heightMm: 30 })
    expect(layout.size).toEqual({ widthMm: 50, heightMm: 30 })
    expect(layout.content.topMm).toBeGreaterThan(9)
  })
})

describe('renderLabelSvg', () => {
  it('is a self-contained SVG sized in mm', () => {
    const svg = renderLabelSvg(labelFor())
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /)
    expect(svg).toContain('width="34.4mm" height="25mm" viewBox="0 0 34.4 25"')
    expect(svg).toMatch(/<\/svg>$/)
    expect(svg).not.toMatch(/href|url\(|<image|<script/)
  })

  it('sizes the SVG to the label size given', () => {
    expect(renderLabelSvg(labelFor(), { widthMm: 50, heightMm: 30 })).toContain(
      'width="50mm" height="30mm" viewBox="0 0 50 30"'
    )
  })

  it('uses presentation attributes only, so it shows under a strict content security policy', () => {
    expect(renderLabelSvg(labelFor())).not.toMatch(/style=|<style/)
  })

  it('sets Arial/Helvetica and keeps spaces in an Item Code', () => {
    const svg = renderLabelSvg(labelFor({ itemCode: 'AIR 01' }))
    expect(svg).toContain('font-family="Arial, Helvetica, sans-serif"')
    expect(svg).toContain('xml:space="preserve"')
    expect(svg).toContain('>AIR 01<')
  })

  it('shows the Item Code, Pack Volume, Expiry and Lot', () => {
    const svg = renderLabelSvg(labelFor({ itemCode: 'PARA18', packVolumeDigit: 2, lot: '(B)A52921725A4' }))
    for (const text of ['>PARA18<', '>60 mL<', '>EXP<', '> 31 DEC 2027<', '>LOT<', '> (B)A52921725A4<']) {
      expect(svg).toContain(text)
    }
  })

  it('escapes XML special characters in an Item Code', () => {
    const svg = renderLabelSvg(labelFor({ itemCode: 'A&B 01' }))
    expect(svg).toContain('>A&amp;B 01<')
    expect(svg).not.toContain('A&B')
  })

  it('embeds the DataMatrix at its true size', () => {
    const label = labelFor()
    const { symbol } = layoutLabel(label)
    const svg = renderLabelSvg(label)
    expect(svg).toContain(`<svg x="${symbol.xMm.toFixed(4)}" y="${symbol.yMm.toFixed(4)}" width="${symbol.widthMm.toFixed(4)}"`)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toMatch(/<path d="M/)
  })

  it('squeezes a line horizontally when it would not fit', () => {
    const svg = renderLabelSvg(labelFor({ lot: 'WWWWWWWWWWWWWWWWWWWW' }))
    expect(svg).toMatch(/transform="translate\([\d.]+ [\d.]+\) scale\(0\.\d+ 1\)"/)
  })
})
