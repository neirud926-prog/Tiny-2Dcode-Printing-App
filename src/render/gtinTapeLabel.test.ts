import { describe, expect, it } from 'vitest'
import { buildLabel, type LabelRequest } from '../core/label'
import { dotMm, type PrinterResolution } from './dataMatrix'
import { gtinLabelSizeProblem, gtinTapeLengthProblem, layoutGtinTapeLabel, renderGtinLabelSvg } from './gtinTapeLabel'
import { renderLabelSvg } from './labelSvg'
import { SMALL_LABEL, type LabelSizeEntry } from './printSettings'

const today = '2026-10-19'

function labelFor(overrides: Partial<LabelRequest> = {}) {
  const result = buildLabel({ itemCode: 'PARA18', packVolumeDigit: 2, expiry: '31122027', lot: '2512172-1', copies: 1, ...overrides }, { today })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.label
}

function tape(tapeWidthMm: number, lengthMm: number): LabelSizeEntry {
  return { id: `tape-${tapeWidthMm}-${lengthMm}`, name: `${tapeWidthMm} mm tape × ${lengthMm} mm`, kind: 'tape', widthMm: lengthMm, heightMm: tapeWidthMm }
}

/** The printable band across each GTIN tape, from the P900 series' dots at 360 dpi (18 → 234, 24 → 320, 36 → 454). */
const BANDS: readonly [number, { topMm: number; bottomMm: number }][] = [
  [18, { topMm: (18 - (234 * 25.4) / 360) / 2, bottomMm: (18 + (234 * 25.4) / 360) / 2 }],
  [24, { topMm: (24 - (320 * 25.4) / 360) / 2, bottomMm: (24 + (320 * 25.4) / 360) / 2 }],
  [36, { topMm: (36 - (454 * 25.4) / 360) / 2, bottomMm: (36 + (454 * 25.4) / 360) / 2 }]
]

function isOnDotGrid(mm: number, dpi: PrinterResolution): boolean {
  const dots = mm / dotMm(dpi)
  return Math.abs(dots - Math.round(dots)) < 1e-9
}

describe('layoutGtinTapeLabel', () => {
  it.each(BANDS)('puts a 7-dot-module DataMatrix at the left of %s mm tape at 360 dpi, centred across the band with a module of quiet zone', (tapeWidthMm, band) => {
    const layout = layoutGtinTapeLabel(labelFor(), tape(tapeWidthMm, 40), 360)
    const { symbol } = layout
    const module = (7 * 25.4) / 360
    expect(symbol.widthMm / symbol.columns).toBeCloseTo(module, 12)
    expect(symbol.widthMm).toBeCloseTo(9.8778, 4) // 20 × 20 modules, about 1 cm
    expect(isOnDotGrid(symbol.xMm, 360) && isOnDotGrid(symbol.yMm, 360)).toBe(true)
    expect(symbol.xMm).toBeGreaterThanOrEqual(module)
    expect(symbol.xMm).toBeLessThan(2)
    expect(symbol.yMm - module).toBeGreaterThanOrEqual(band.topMm)
    expect(symbol.yMm + symbol.heightMm + module).toBeLessThanOrEqual(band.bottomMm)
    expect(Math.abs(symbol.yMm + symbol.heightMm / 2 - tapeWidthMm / 2)).toBeLessThanOrEqual(dotMm(360))
  })

  it.each(BANDS)('keeps the Item Code + Pack Volume, EXP and LOT lines at 6.5 pt inside the band of %s mm tape, right of the code', (tapeWidthMm, band) => {
    const layout = layoutGtinTapeLabel(labelFor({ lot: 'ABCDEFGHIJ0123456789' }), tape(tapeWidthMm, 60), 203)
    const lines = [layout.itemCodeLine, layout.expiryLine, layout.lotLine]
    expect(lines.map((line) => line.runs.map((run) => run.text).join(''))).toEqual(['PARA1860 mL', 'EXP 31 DEC 2027', 'LOT ABCDEFGHIJ0123456789'])
    for (const line of lines) {
      expect(line.runs.every((run) => run.fontSizePt === 6.5)).toBe(true)
      expect(line.xMm).toBeGreaterThan(layout.symbol.xMm + layout.symbol.widthMm)
      expect(line.topMm).toBeGreaterThanOrEqual(band.topMm)
      expect(line.bottomMm).toBeLessThanOrEqual(band.bottomMm)
      expect(line.scaleX).toBe(1)
      expect(line.xMm + line.widthMm).toBeLessThanOrEqual(60)
    }
    expect(layout.itemCodeLine.baselineMm).toBeLessThan(layout.expiryLine.baselineMm)
    expect(layout.expiryLine.baselineMm).toBeLessThan(layout.lotLine.baselineMm)
  })

  it('is as long as the loaded Tape Size', () => {
    expect(layoutGtinTapeLabel(labelFor(), tape(24, 45), 360).size).toEqual({ widthMm: 45, heightMm: 24 })
  })
})

describe('gtinTapeLengthProblem', () => {
  it.each([
    ['a typical label', {}],
    ['the widest 20-character Lot', { lot: 'WWWWWWWWWWWWWWWWWWWW' }]
  ])('names the minimum length in whole mm, at which the text fits unsqueezed (%s)', (_case, overrides: Partial<LabelRequest>) => {
    const label = labelFor(overrides)
    const problem = gtinTapeLengthProblem(label, tape(24, 15), 360)
    const minimum = Number(/at least (\d+) mm/.exec(problem ?? '')?.[1])
    expect(problem).toBe(`This GTIN Label needs tape at least ${minimum} mm long; the loaded Tape Size is 15 mm. Add a longer Tape Size in Settings.`)
    expect(gtinTapeLengthProblem(label, tape(24, minimum), 360)).toBeNull()
    expect(gtinTapeLengthProblem(label, tape(24, minimum - 1), 360)).not.toBeNull()
    const fits = layoutGtinTapeLabel(label, tape(24, minimum), 360)
    for (const line of [fits.itemCodeLine, fits.expiryLine, fits.lotLine]) expect(line.scaleX).toBe(1)
  })

  it('is null on the Small Label', () => {
    expect(gtinTapeLengthProblem(labelFor(), SMALL_LABEL, 203)).toBeNull()
  })
})

describe('gtinLabelSizeProblem', () => {
  const sizes = [SMALL_LABEL, tape(12, 40), tape(18, 40), tape(24, 40), tape(36, 40), { id: 'shelf', name: 'Shelf', kind: 'label' as const, widthMm: 50, heightMm: 30 }]
  const refusal = 'GTIN Labels print on the Small Label (34.4 × 25 mm) or on 18, 24 or 36 mm tape. Change the label in Settings.'

  it('allows the Small Label and 18, 24 or 36 mm tape, and refuses narrower tape, other die-cut sizes and sizes not listed', () => {
    expect(gtinLabelSizeProblem(SMALL_LABEL.id, sizes)).toBeNull()
    for (const width of [18, 24, 36]) expect(gtinLabelSizeProblem(`tape-${width}-40`, sizes)).toBeNull()
    expect(gtinLabelSizeProblem('tape-12-40', sizes)).toBe(refusal)
    expect(gtinLabelSizeProblem('shelf', sizes)).toBe(refusal)
    expect(gtinLabelSizeProblem('gone', sizes)).toBe(refusal)
  })
})

describe('renderGtinLabelSvg', () => {
  it('draws the tape layout on a Tape Size and the Small Label layout otherwise', () => {
    const label = labelFor()
    expect(renderGtinLabelSvg(label, SMALL_LABEL, 203)).toBe(renderLabelSvg(label, SMALL_LABEL, 203))
    const svg = renderGtinLabelSvg(label, tape(24, 40), 360)
    expect(svg).toContain('width="40mm" height="24mm" viewBox="0 0 40 24"')
    expect(svg).toContain('PARA18')
    expect(svg).toContain('LOT</tspan>')
  })
})
