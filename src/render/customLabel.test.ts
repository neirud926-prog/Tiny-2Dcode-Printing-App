import { describe, expect, it } from 'vitest'
import { LAYOUT_1, LAYOUT_2, type Template } from '../core/template'
import { buildCustomLabel, renderCustomLabelSvg, type CustomLabelInput } from './customLabel'
import { DOT_MM } from './dataMatrix'
import { SMALL_LABEL } from './printSettings'

const input: CustomLabelInput = { symbology: 'datamatrix', codeValue: 'SHELF-1C5A', texts: ['Shelf 1C5A'], copies: 1 }

function errorsOf(template: Template, overrides: Partial<CustomLabelInput>) {
  const built = buildCustomLabel(template, SMALL_LABEL, { ...input, ...overrides }, 203)
  return built.ok ? [] : built.errors
}

function labelOf(template: Template, overrides: Partial<CustomLabelInput> = {}) {
  const built = buildCustomLabel(template, SMALL_LABEL, { ...input, ...overrides }, 203)
  if (!built.ok) throw new Error(JSON.stringify(built.errors))
  return built.label
}

function isOnDotGrid(mm: number): boolean {
  return Math.abs(mm / DOT_MM - Math.round(mm / DOT_MM)) < 1e-9
}

const FORTY = 'ABCDEFGHIJabcdefghij0123456789 -_./:#()+'

describe('buildCustomLabel: the code data', () => {
  it('takes 1–40 characters of A–Z a–z 0–9 space and - _ . / : # ( ) + *', () => {
    expect(errorsOf(LAYOUT_1, { codeValue: FORTY })).toEqual([])
    expect(errorsOf(LAYOUT_1, { codeValue: '*' })).toEqual([])
    expect(errorsOf(LAYOUT_1, { codeValue: '' })).toEqual([{ field: 'code', message: 'Enter the code data.' }])
    expect(errorsOf(LAYOUT_1, { codeValue: `${FORTY}*` })).toEqual([{ field: 'code', message: 'The code data must be at most 40 characters.' }])
    for (const bad of ['a;b', 'é', 'a,b', 'a&b', 'a\tb', '%', '^040']) {
      expect(errorsOf(LAYOUT_1, { codeValue: bad })).toEqual([
        { field: 'code', message: 'The code data may hold only A–Z, a–z, 0–9, space and - _ . / : # ( ) + *.' }
      ])
    }
  })

  it('refuses a space at the start or end, which nobody could see on the label', () => {
    expect(errorsOf(LAYOUT_1, { codeValue: ' A1' })).toEqual([{ field: 'code', message: 'The code data cannot start or end with a space.' }])
    expect(errorsOf(LAYOUT_1, { codeValue: 'A1 ' })).toEqual([{ field: 'code', message: 'The code data cannot start or end with a space.' }])
    expect(errorsOf(LAYOUT_1, { codeValue: 'A 1' })).toEqual([])
  })

  it('holds exactly the typed data, in the chosen symbology', () => {
    expect(labelOf(LAYOUT_1, { codeValue: 'Bin 4 # (top)', symbology: 'qr' })).toMatchObject({ codeValue: 'Bin 4 # (top)', symbology: 'qr' })
  })

  it('of a fixed code is the Template’s, whatever is typed', () => {
    const fixed: Template = { ...LAYOUT_1, code: { ...LAYOUT_1.code, mode: 'fixed', value: 'FIXED-1' } }
    expect(labelOf(fixed, { codeValue: '' }).codeValue).toBe('FIXED-1')
  })
})

describe('buildCustomLabel: text lines', () => {
  it('take the same characters, up to the line’s maximum, and may be empty', () => {
    expect(errorsOf(LAYOUT_2, { texts: ['', '', '', ''] })).toEqual([])
    expect(errorsOf(LAYOUT_2, { texts: ['abc', 'a;b', '', '1234567890123456'] })).toEqual([
      { field: 'line2', message: 'Line 2 may hold only A–Z, a–z, 0–9, space and - _ . / : # ( ) + *.' }
    ])
    expect(errorsOf(LAYOUT_2, { texts: ['', '', '', '12345678901234567'] })).toEqual([{ field: 'line4', message: 'Line 4 must be at most 16 characters.' }])
    expect(errorsOf(LAYOUT_1, { texts: ['ABCDEFGHIJ1234567890X'] })).toEqual([{ field: 'line1', message: 'Line 1 must be at most 20 characters.' }])
  })

  it('are squeezed to fit their box, down to 70% of their width', () => {
    const label = labelOf(LAYOUT_2, { texts: ['PARA01 ABCDEFGHI', 'short', '', ''] })
    expect(label.lines[0].scaleX).toBeLessThan(1)
    expect(label.lines[0].scaleX).toBeGreaterThanOrEqual(0.7)
    expect(label.lines[0].widthMm * label.lines[0].scaleX).toBeCloseTo(LAYOUT_2.texts[0].widthMm, 9)
    expect(label.lines[1].scaleX).toBe(1)
  })

  it('are refused, naming the line, when even 70% is too wide', () => {
    expect(errorsOf(LAYOUT_2, { texts: ['', 'WWWWWWWWWWWWWWWW', '', ''] })).toEqual([{ field: 'line2', message: 'Line 2 is too long for this template.' }])
    expect(errorsOf(LAYOUT_1, { texts: ['MMMMMMMMMMMMMMMMMMMM'] })).toEqual([{ field: 'line1', message: 'Line 1 is too long for this template.' }])
    expect(errorsOf(LAYOUT_1, { texts: ['Shelf 1C5A Bin 4 top'] })).toEqual([])
  })

  it('of a fixed line are the Template’s; the typed texts fill only the fill-in lines, in order', () => {
    const template: Template = { ...LAYOUT_2, texts: LAYOUT_2.texts.map((text, i) => (i === 0 ? { ...text, mode: 'fixed', value: 'PHARMACY' } : text)) }
    expect(labelOf(template, { texts: ['a', 'b', 'c'] }).texts).toEqual(['PHARMACY', 'a', 'b', 'c'])
    expect(errorsOf(template, { texts: ['a', 'b'] })).toEqual([{ field: 'template', message: 'The text lines do not match this template.' }])
  })

  it('centre in their box when the Template says so', () => {
    const label = labelOf(LAYOUT_1, { texts: ['AB'] })
    const line = label.lines[0]
    expect(line.xMm - LAYOUT_1.texts[0].xMm).toBeCloseTo(LAYOUT_1.texts[0].xMm + LAYOUT_1.texts[0].widthMm - (line.xMm + line.widthMm), 9)
    expect(labelOf(LAYOUT_2, { texts: ['AB', '', '', ''] }).lines[0].xMm).toBe(14)
  })
})

describe('buildCustomLabel: copies and fit', () => {
  it('takes 1–99 copies', () => {
    expect(errorsOf(LAYOUT_1, { copies: 99 })).toEqual([])
    for (const copies of [0, 100, 1.5, Number.NaN]) {
      expect(errorsOf(LAYOUT_1, { copies })).toEqual([{ field: 'copies', message: 'Copies must be a whole number from 1 to 99.' }])
    }
  })

  it('refuses a code that does not fit inside the label at its position', () => {
    const big: Template = { ...LAYOUT_2, code: { ...LAYOUT_2.code, moduleSize: 'large' } }
    expect(errorsOf(big, { symbology: 'qr', texts: ['', '', '', ''] })).toEqual([{ field: 'template', message: 'The code does not fit inside the label at its position.' }])
  })
})

describe('buildCustomLabel: Printer resolution', () => {
  // A Large QR code is 18.14 mm at 203 dpi (5 dots) but 18.42 mm at 360 dpi (9 dots), each with about 2.5 mm of quiet zone.
  const strip = { widthMm: 40, heightMm: 23.7 }
  const large: Template = { ...LAYOUT_1, texts: [], code: { ...LAYOUT_1.code, xMm: 20, yMm: 12, moduleSize: 'large' } }
  const request = { ...input, symbology: 'qr' as const, texts: [] }

  it('checks the fit at the PC’s own resolution', () => {
    expect(buildCustomLabel(large, strip, request, 203)).toMatchObject({ ok: true })
    expect(buildCustomLabel(large, strip, request, 360)).toEqual({ ok: false, errors: [{ field: 'template', message: 'The code does not fit inside the label at its position.' }] })
  })

  it('draws the modules in whole dots at it: Layout 2 at 360 dpi has 5-dot modules on the 360 dpi grid', () => {
    const built = buildCustomLabel(LAYOUT_2, SMALL_LABEL, { ...input, texts: ['', '', '', ''] }, 360)
    if (!built.ok) throw new Error(JSON.stringify(built.errors))
    const dots = (mm: number) => (mm * 360) / 25.4
    expect(built.label.symbol.widthMm).toBeCloseTo((26 * 5 * 25.4) / 360, 12)
    expect(Math.abs(dots(built.label.symbol.xMm) - Math.round(dots(built.label.symbol.xMm)))).toBeLessThan(1e-9)
  })
})

describe('Layouts 1 and 2', () => {
  it.each([
    ['Layout 1', LAYOUT_1, [FORTY.slice(0, 20)]],
    ['Layout 2', LAYOUT_2, ['abcdefghijklmnop', 'Shelf 1C5A', '0123456789012345', 'x']]
  ] as const)('%s holds a 40-character code, DataMatrix or QR, on whole dots, quiet zone and lines inside the label', (_name, template, texts) => {
    for (const symbology of ['datamatrix', 'qr'] as const) {
      const label = labelOf(template, { symbology, codeValue: FORTY, texts: [...texts] })
      const { symbol } = label
      expect(isOnDotGrid(symbol.xMm) && isOnDotGrid(symbol.yMm)).toBe(true)
      const margin = Math.max(1, symbol.quietZoneMm)
      expect(symbol.xMm).toBeGreaterThanOrEqual(margin)
      expect(symbol.yMm).toBeGreaterThanOrEqual(margin)
      expect(symbol.xMm + symbol.widthMm).toBeLessThanOrEqual(SMALL_LABEL.widthMm - margin)
      expect(symbol.yMm + symbol.heightMm).toBeLessThanOrEqual(SMALL_LABEL.heightMm - margin)
      for (const line of label.lines) {
        expect(line.xMm).toBeGreaterThanOrEqual(1)
        expect(line.xMm + line.widthMm * line.scaleX).toBeLessThanOrEqual(SMALL_LABEL.widthMm - 1 + 1e-9)
        expect(line.topMm).toBeGreaterThanOrEqual(1)
        expect(line.bottomMm).toBeLessThanOrEqual(SMALL_LABEL.heightMm - 1)
        // Clear of the code's quiet zone.
        const clearBeside = line.xMm >= symbol.xMm + symbol.widthMm + symbol.quietZoneMm
        const clearBelow = line.topMm >= symbol.yMm + symbol.heightMm + symbol.quietZoneMm
        expect(clearBeside || clearBelow).toBe(true)
      }
    }
  })

  it('Layout 1 centres the code across the label', () => {
    const { symbol } = labelOf(LAYOUT_1)
    expect(Math.abs(symbol.xMm + symbol.widthMm / 2 - SMALL_LABEL.widthMm / 2)).toBeLessThanOrEqual(DOT_MM / 2) // on the dot grid
  })
})

describe('renderCustomLabelSvg', () => {
  it('is a self-contained SVG at the label size with the code and the non-empty lines', () => {
    const svg = renderCustomLabelSvg(labelOf(LAYOUT_2, { texts: ['Bin #4 (top)', '', 'a+b', ''] }))
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="34.4mm" height="25mm" viewBox="0 0 34.4 25"/)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain('>Bin #4 (top)</tspan>')
    expect(svg).toContain('>a+b</tspan>')
    expect(svg.match(/<text /g)).toHaveLength(2)
    expect(svg).not.toMatch(/href|url\(|<image|<script|style=/)
  })
})
