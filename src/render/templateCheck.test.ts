import { describe, expect, it } from 'vitest'
import { LAYOUT_1, LAYOUT_2, type Template, type TemplateText } from '../core/template'
import { templatePreviewSvg, templateProblems, textMaxLength } from './customLabel'
import { SMALL_LABEL, type LabelSizeEntry } from './printSettings'

const SHELF: LabelSizeEntry = { id: 'shelf', name: 'Shelf', widthMm: 50, heightMm: 30 }

/** A Template made in the designer on the Shelf size: code on the left, two lines to its right, all on the 0.5 mm grid. */
const DESIGNED: Template = {
  id: 'shelf-bin',
  name: 'Shelf bin',
  labelSizeId: SHELF.id,
  builtIn: false,
  code: { xMm: 10, yMm: 15, symbology: 'datamatrix', moduleSize: 'medium', mode: 'fill' },
  texts: [
    { id: 'line-1', xMm: 20, yMm: 10, widthMm: 28, align: 'left', fontSizePt: 10, bold: true, mode: 'fixed', value: 'PHARMACY' },
    { id: 'line-2', xMm: 20, yMm: 16, widthMm: 28, align: 'left', fontSizePt: 8, bold: false, mode: 'fill' }
  ]
}

function withText(template: Template, index: number, change: Partial<TemplateText>): Template {
  return { ...template, texts: template.texts.map((text, i) => (i === index ? { ...text, ...change } : text)) }
}

describe('templateProblems: a Template to save', () => {
  it('accepts a designed Template, and the built-ins and copies of them at their exact positions', () => {
    expect(templateProblems(DESIGNED, SHELF)).toEqual([])
    expect(templateProblems(LAYOUT_1, SMALL_LABEL, LAYOUT_1)).toEqual([])
    expect(templateProblems(LAYOUT_2, SMALL_LABEL, LAYOUT_2)).toEqual([])
    const copy = { ...LAYOUT_2, id: 'copy', name: 'My layout', builtIn: false }
    expect(templateProblems(copy, SMALL_LABEL, LAYOUT_2)).toEqual([])
  })

  it('keeps the code, with its quiet zone, at least 1 mm inside the label, whichever code is printed', () => {
    expect(templateProblems({ ...DESIGNED, code: { ...DESIGNED.code, xMm: 6 } }, SHELF)).toEqual(['The code must be at least 1 mm inside the label.'])
    // Large QR is 18.4 mm at 360 dpi (9 dots) with 2.5 mm of quiet zone: on a 30 mm label its centre must be 11.8 mm from the top at least.
    const qr5 = { ...DESIGNED, texts: [], code: { ...DESIGNED.code, moduleSize: 'large' as const, xMm: 25, yMm: 11.5 } }
    expect(templateProblems(qr5, SHELF)).toEqual(['The code must be at least 1 mm inside the label.'])
    expect(templateProblems({ ...qr5, code: { ...qr5.code, yMm: 15 } }, SHELF)).toEqual([])
  })

  it('checks the code at its largest across the Printer resolutions, so it fits on every PC', () => {
    // Large QR at 203 dpi (5 dots) ends 23.57 mm down with its quiet zone; at 360 dpi (9 dots) 23.75 mm.
    const strip: LabelSizeEntry = { id: 'strip', name: 'Strip', widthMm: 40, heightMm: 23.7 }
    const large: Template = { ...DESIGNED, labelSizeId: strip.id, texts: [], code: { ...DESIGNED.code, moduleSize: 'large', xMm: 20, yMm: 12 } }
    expect(templateProblems(large, strip)).toEqual(['The code must be at least 1 mm inside the label.'])
    expect(templateProblems(large, { ...strip, heightMm: 23.8 })).toEqual([])
  })

  it('keeps each text box at least 1 mm inside the label', () => {
    expect(templateProblems(withText(DESIGNED, 1, { widthMm: 29.5 }), SHELF)).toEqual(['Line 2 must be at least 1 mm inside the label.'])
    expect(templateProblems(withText(DESIGNED, 1, { yMm: 26.5 }), SHELF)).toEqual(['Line 2 must be at least 1 mm inside the label.'])
    expect(templateProblems(withText(DESIGNED, 0, { xMm: 0.5 }), SHELF)).toContain('Line 1 must be at least 1 mm inside the label.')
  })

  it('never lets the code (with its quiet zone) overlap a text box', () => {
    expect(templateProblems(withText(DESIGNED, 0, { xMm: 17 }), SHELF)).toEqual(['Line 1 overlaps the code.'])
    expect(templateProblems({ ...LAYOUT_1, texts: [{ ...LAYOUT_1.texts[0], yMm: 17 }] }, SMALL_LABEL, LAYOUT_1)).toEqual(['Line 1 overlaps the code.'])
  })

  it('takes at most 6 text lines, sizes 6.5 / 8 / 10 pt and 3 / 4 / 5 dots per module', () => {
    const seven = { ...DESIGNED, texts: Array.from({ length: 7 }, (_, i) => ({ ...DESIGNED.texts[1], id: `l${i}`, yMm: 2 + i * 3.5, xMm: 20 })) }
    expect(templateProblems(seven, SHELF)).toEqual(['A template has at most 6 text lines.'])
    expect(templateProblems(withText(DESIGNED, 1, { fontSizePt: 9 as never }), SHELF)).toEqual(['Line 2 text size must be 6.5, 8 or 10 pt.'])
    expect(templateProblems({ ...DESIGNED, code: { ...DESIGNED.code, moduleSize: 'huge' as never } }, SHELF)).toEqual(['The code module size must be Small, Medium or Large.'])
  })

  it('needs a valid value for a fixed code or fixed line', () => {
    const fixedCode = (value: string | undefined): Template => ({ ...DESIGNED, code: { ...DESIGNED.code, mode: 'fixed', value } })
    expect(templateProblems(fixedCode('BIN-4'), SHELF)).toEqual([])
    expect(templateProblems(fixedCode(''), SHELF)).toEqual(['Enter the fixed code data.'])
    expect(templateProblems(fixedCode(undefined), SHELF)).toEqual(['Enter the fixed code data.'])
    expect(templateProblems(fixedCode('A'.repeat(41)), SHELF)).toEqual(['The code data must be at most 40 characters.'])
    expect(templateProblems(fixedCode('a;b'), SHELF)).toEqual(['The code data may hold only A–Z, a–z, 0–9, space and - _ . / : # ( ) + *.'])
    expect(templateProblems(fixedCode(' A'), SHELF)).toEqual(['The code data cannot start or end with a space.'])
    expect(templateProblems(withText(DESIGNED, 0, { value: 'a;b' }), SHELF)).toEqual(['Line 1 may hold only A–Z, a–z, 0–9, space and - _ . / : # ( ) + *.'])
    expect(templateProblems(withText(DESIGNED, 0, { value: 'W'.repeat(30) }), SHELF)).toEqual(['Line 1 is too long for this template.'])
    expect(templateProblems(withText(DESIGNED, 0, { value: '' }), SHELF)).toEqual([])
  })

  it('takes a fill-in line’s maximum length as set (1–40), else from its box width', () => {
    expect(templateProblems(withText(DESIGNED, 1, { maxLength: 0 }), SHELF)).toEqual(['Line 2 maximum length must be a whole number from 1 to 40.'])
    expect(templateProblems(withText(DESIGNED, 1, { maxLength: 41 }), SHELF)).toEqual(['Line 2 maximum length must be a whole number from 1 to 40.'])
    expect(textMaxLength(LAYOUT_1.texts[0])).toBe(20)
    // 8 pt digits in a 28 mm box: about 17 fit unsqueezed.
    expect(textMaxLength(DESIGNED.texts[1])).toBe(17)
    expect(textMaxLength({ ...DESIGNED.texts[1], widthMm: 2 })).toBe(1)
    expect(textMaxLength({ ...DESIGNED.texts[1], widthMm: 140, fontSizePt: 6.5 })).toBe(40)
  })

  it('previews a Template as designed: fixed values, fill-in lines named, whether valid yet or not', () => {
    const svg = templatePreviewSvg(withText(DESIGNED, 1, { xMm: 3 }), SHELF)
    expect(svg).toContain('>PHARMACY</tspan>')
    expect(svg).toContain('>Line 2</tspan>')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="50mm" height="30mm"/)
  })

  it('wants positions moved in the designer on the 0.5 mm grid; positions kept from the original need not be', () => {
    expect(templateProblems({ ...DESIGNED, code: { ...DESIGNED.code, xMm: 10.2 } }, SHELF)).toEqual(['The code must sit on the 0.5 mm grid.'])
    expect(templateProblems(withText(DESIGNED, 1, { yMm: 16.3 }), SHELF)).toEqual(['Line 2 must sit on the 0.5 mm grid.'])
    const copy = { ...LAYOUT_2, id: 'copy', builtIn: false }
    const moved = { ...copy, code: { ...copy.code, yMm: 12.3 } }
    expect(templateProblems(moved, SMALL_LABEL, copy)).toEqual(['The code must sit on the 0.5 mm grid.'])
    expect(templateProblems({ ...copy, code: { ...copy.code, yMm: 12 } }, SMALL_LABEL, copy)).toEqual([])
  })
})
