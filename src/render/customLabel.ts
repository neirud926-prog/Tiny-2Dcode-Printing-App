/**
 * A Custom Label from a Template: the checks on what staff typed, the layout and the SVG. Built the
 * same way on screen (live preview and field messages) and in the app service (the last gate before
 * the printer), with the GTIN Label's text and SVG helpers.
 *
 * Pure: no Node, DOM or Electron.
 */

import { MAX_COPIES, MIN_COPIES } from '../core/label'
import {
  DESIGN_GRID_MM,
  MODULE_SIZE_CHOICES,
  MAX_CODE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TEXT_LINES,
  PLAIN_CHARACTERS,
  PLAIN_CHARACTERS_TEXT,
  TEXT_SIZE_CHOICES,
  type ModuleSize,
  type Symbology,
  type Template,
  type TemplateCode,
  type TemplateText
} from '../core/template'
import { moduleMm, PRINTER_RESOLUTIONS, renderPlainCode, type PlainCodeSymbol, type PrinterResolution } from './dataMatrix'
import { capHeightMm, labelSvgDocument, line, ROUNDING_TOLERANCE, run, snapToDot, WIDTH_SAFETY, type LabelSize, type TextLine } from './labelSvg'
import { textWidthMm } from './textMetrics'
import { formatLabelSizeMm, type FitSize, type LabelSizeEntry } from './printSettings'
import { isTapeWidthMm, printableBandMm } from './tapeSize'

/** Text squeezed narrower than this share of its width is refused instead. */
export const MIN_TEXT_SCALE = 0.7
/** Text stays at least this far inside the label; the code at least this far, or its quiet zone if more. */
export const MIN_EDGE_MM = 1

/** What staff typed for a Custom Label. */
export interface CustomLabelInput {
  readonly symbology: Symbology
  /** The code data; ignored when the Template's code is fixed. */
  readonly codeValue: string
  /** One per fill-in text line of the Template, in order. */
  readonly texts: readonly string[]
  readonly copies: number
}

/** The request the screen sends to print: the input and the Template it is for. */
export interface CustomLabelRequest extends CustomLabelInput {
  readonly templateId: string
}

/** `lineN` is the Template's N-th text line. */
export type CustomLabelField = 'template' | 'code' | 'copies' | `line${number}`

export interface CustomFieldMessage {
  readonly field: CustomLabelField
  readonly message: string
}

export interface CustomLabel {
  readonly templateId: string
  readonly templateName: string
  readonly size: LabelSize
  readonly symbology: Symbology
  /** Exactly what the code holds. */
  readonly codeValue: string
  /** Every text line's text, fixed and fill-in, in the Template's order (empty lines included). */
  readonly texts: readonly string[]
  readonly copies: number
  readonly symbol: PlainCodeSymbol & { readonly xMm: number; readonly yMm: number }
  /** The laid-out text lines, one per Template text line. */
  readonly lines: readonly TextLine[]
}

export type BuildCustomLabelResult = { ok: true; label: CustomLabel } | { ok: false; errors: CustomFieldMessage[] }

/**
 * Checks what staff typed against `template` on a label of `size`, and lays the label out for a
 * printer of `dpi` (the PC's Printer resolution).
 */
export function buildCustomLabel(template: Template, size: FitSize, input: CustomLabelInput, dpi: PrinterResolution): BuildCustomLabelResult {
  const errors: CustomFieldMessage[] = []

  const codeValue = template.code.mode === 'fixed' ? (template.code.value ?? '') : input.codeValue
  const codeProblem = codeValueProblem(codeValue)
  if (codeProblem) errors.push({ field: 'code', message: codeProblem })

  const fillCount = template.texts.filter((text) => text.mode === 'fill').length
  if (input.texts.length !== fillCount) return { ok: false, errors: [...errors, { field: 'template', message: 'The text lines do not match this template.' }] }
  let fill = 0
  const texts = template.texts.map((text) => (text.mode === 'fixed' ? (text.value ?? '') : input.texts[fill++]))

  const lines = template.texts.map((element, i) => {
    const field: CustomLabelField = `line${i + 1}`
    const name = `Line ${i + 1}`
    const value = texts[i]
    const problem = plainTextProblem(value, name)
    const maxLength = textMaxLength(element)
    if (problem) errors.push({ field, message: problem })
    else if (element.mode === 'fill' && value.length > maxLength) errors.push({ field, message: `${name} must be at most ${maxLength} characters.` })

    const laidOut = layOutText(element, value)
    if (!problem && laidOut.scaleX < MIN_TEXT_SCALE) errors.push({ field, message: `${name} is too long for this template.` })
    return laidOut
  })

  const { copies } = input
  if (!Number.isInteger(copies) || copies < MIN_COPIES || copies > MAX_COPIES) {
    errors.push({ field: 'copies', message: `Copies must be a whole number from ${MIN_COPIES} to ${MAX_COPIES}.` })
  }

  if (errors.length > 0) return { ok: false, errors }

  // The modules sit on whole printer dots; the code is the same size whatever its data.
  const drawn = renderPlainCode(input.symbology, codeValue, template.code.moduleSize, dpi)
  const symbol = { ...drawn, ...placed(template.code, drawn, dpi) }
  if (!codeFits(symbol, size)) {
    const where = tapeBand(size) ? 'the printable band of the tape' : 'the label'
    return { ok: false, errors: [{ field: 'template', message: `The code does not fit inside ${where} at its position.` }] }
  }

  return {
    ok: true,
    label: {
      templateId: template.id,
      templateName: template.name,
      size: { widthMm: size.widthMm, heightMm: size.heightMm },
      symbology: input.symbology,
      codeValue,
      texts,
      copies,
      symbol,
      lines
    }
  }
}

/**
 * Why `template` cannot print on this PC: it prints only on the Label Size it was made for, which
 * must be the one loaded. `sizes` is the Label Size list; null when it can print.
 */
export function templateSizeProblem(template: Template, loadedSizeId: string, sizes: readonly LabelSizeEntry[]): string | null {
  if (template.labelSizeId === loadedSizeId) return null
  const made = sizes.find((size) => size.id === template.labelSizeId)
  const loaded = sizes.find((size) => size.id === loadedSizeId)
  const madeText = made ? `${made.name} (${formatLabelSizeMm(made)})` : 'a label size no longer in the list'
  const loadedText = loaded ? `${loaded.name} (${formatLabelSizeMm(loaded)})` : 'a label size no longer in the list'
  return `This template was made for ${madeText}; this PC prints ${loadedText}. Change the label in Settings.`
}

/** The label as a self-contained SVG document; empty lines are left out. */
export function renderCustomLabelSvg(label: CustomLabel): string {
  return labelSvgDocument(
    label.size,
    label.symbol,
    label.lines.filter((_, i) => label.texts[i] !== '')
  )
}

/** The symbol's top-left: centred on the code's position, on whole printer dots at `dpi`. */
function placed(code: TemplateCode, drawn: { readonly widthMm: number; readonly heightMm: number }, dpi: PrinterResolution): { xMm: number; yMm: number } {
  return { xMm: snapToDot(code.xMm - drawn.widthMm / 2, dpi), yMm: snapToDot(code.yMm - drawn.heightMm / 2, dpi) }
}

/** The resolution at which modules of `size` are largest (e.g. Large: 9 dots at 360 dpi, 0.635 mm). */
export function largestModuleResolution(size: ModuleSize): PrinterResolution {
  return PRINTER_RESOLUTIONS.reduce((largest, dpi) => (moduleMm(size, dpi) > moduleMm(size, largest) ? dpi : largest))
}

/** The printable band across a Tape Size, or null for a die-cut label. */
function tapeBand(size: FitSize): { topMm: number; bottomMm: number } | null {
  return size.kind === 'tape' && isTapeWidthMm(size.heightMm) ? printableBandMm(size.heightMm) : null
}

/**
 * The symbol at least 1 mm inside the label, and its quiet zone inside it; on a Tape Size, across
 * the tape the symbol with its quiet zone inside the printable band.
 */
function codeFits(symbol: Box & { readonly quietZoneMm: number }, size: FitSize): boolean {
  const margin = Math.max(MIN_EDGE_MM, symbol.quietZoneMm) - ROUNDING_TOLERANCE
  const band = tapeBand(size)
  const along = symbol.xMm >= margin && symbol.xMm + symbol.widthMm <= size.widthMm - margin
  if (!band) return along && symbol.yMm >= margin && symbol.yMm + symbol.heightMm <= size.heightMm - margin
  return along && symbol.yMm - symbol.quietZoneMm >= band.topMm - ROUNDING_TOLERANCE && symbol.yMm + symbol.heightMm + symbol.quietZoneMm <= band.bottomMm + ROUNDING_TOLERANCE
}

/** A text box at least 1 mm inside the label; on a Tape Size, across the tape inside the printable band. */
function textFits(box: Box, size: FitSize): boolean {
  const edge = MIN_EDGE_MM - ROUNDING_TOLERANCE
  const band = tapeBand(size)
  const top = band ? band.topMm - ROUNDING_TOLERANCE : edge
  const bottom = band ? band.bottomMm + ROUNDING_TOLERANCE : size.heightMm - edge
  return box.xMm >= edge && box.xMm + box.widthMm <= size.widthMm - edge && box.yMm >= top && box.yMm + box.heightMm <= bottom
}

/** A text line laid out in its box: squeezed if too wide, centred if the Template says so. */
function layOutText(element: TemplateText, value: string): TextLine {
  const laidOut = line([run(value, element.fontSizePt, element.bold)], element.xMm, element.yMm + capHeightMm(element.fontSizePt), element.widthMm)
  const centred = element.align === 'center' && laidOut.scaleX === 1
  return centred ? { ...laidOut, xMm: element.xMm + (element.widthMm - laidOut.widthMm) / 2 } : laidOut
}

/**
 * At most this many characters may be typed in a fill-in line: its `maxLength` if set, else as many
 * digits as fit its box unsqueezed (1 to {@link MAX_TEXT_LENGTH}).
 */
export function textMaxLength(element: TemplateText): number {
  if (element.maxLength !== undefined) return element.maxLength
  const digitMm = textWidthMm('0', element.fontSizePt, element.bold) * WIDTH_SAFETY
  return Math.min(MAX_TEXT_LENGTH, Math.max(1, Math.floor(element.widthMm / digitMm + ROUNDING_TOLERANCE)))
}

/** A rectangle on the label, in mm from its top-left. */
export interface Box {
  readonly xMm: number
  readonly yMm: number
  readonly widthMm: number
  readonly heightMm: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.xMm < b.xMm + b.widthMm && b.xMm < a.xMm + a.widthMm && a.yMm < b.yMm + b.heightMm && b.yMm < a.yMm + a.heightMm
}

function onGrid(mm: number): boolean {
  return Math.abs(mm / DESIGN_GRID_MM - Math.round(mm / DESIGN_GRID_MM)) < 1e-6
}

/** A text line's box: its width, and from its top down to the bottom of its descenders. */
export function textBox(element: TemplateText): Box {
  const laidOut = layOutText({ ...element, align: 'left' }, '')
  return { xMm: element.xMm, yMm: element.yMm, widthMm: element.widthMm, heightMm: laidOut.bottomMm - element.yMm }
}

/**
 * The area the code keeps clear, quiet zone included, for whichever code staff print (DataMatrix or
 * QR at the Template's module size; the size never depends on the data) on any PC, and whether all
 * of it fits. Taken over every Printer resolution, so it covers the largest module and a Template
 * that fits on one PC fits on every PC.
 */
export function codeArea(code: TemplateCode, size: FitSize): { box: Box; fits: boolean } {
  const symbols = (['datamatrix', 'qr'] as const).flatMap((symbology) =>
    PRINTER_RESOLUTIONS.map((dpi) => {
      const drawn = renderPlainCode(symbology, 'A', code.moduleSize, dpi)
      return { ...drawn, ...placed(code, drawn, dpi) }
    })
  )
  const left = Math.min(...symbols.map((s) => s.xMm - s.quietZoneMm))
  const top = Math.min(...symbols.map((s) => s.yMm - s.quietZoneMm))
  const right = Math.max(...symbols.map((s) => s.xMm + s.widthMm + s.quietZoneMm))
  const bottom = Math.max(...symbols.map((s) => s.yMm + s.heightMm + s.quietZoneMm))
  return { box: { xMm: left, yMm: top, widthMm: right - left, heightMm: bottom - top }, fits: symbols.every((symbol) => codeFits(symbol, size)) }
}

/**
 * Why `template` cannot be saved for a label of `size`; empty when it can. Every code it may print
 * and every text box must sit inside the label (on a Tape Size, across the tape inside the printable
 * band, quiet zone included), the text clear of the code's quiet zone. Positions
 * must be on the designer's 0.5 mm grid, except those kept unchanged from `original` (the stored
 * Template, or the one copied), so a copy of Layout 1 or 2 keeps its exact positions.
 */
export function templateProblems(template: Template, size: FitSize, original?: Template | null): string[] {
  const { code } = template
  if (!MODULE_SIZE_CHOICES.includes(code.moduleSize)) return ['The code module size must be Small, Medium or Large.']
  const problems: string[] = []
  if (template.texts.length > MAX_TEXT_LINES) problems.push(`A template has at most ${MAX_TEXT_LINES} text lines.`)

  if (code.mode === 'fixed') {
    const problem = (code.value ?? '') === '' ? 'Enter the fixed code data.' : codeValueProblem(code.value ?? '')
    if (problem) problems.push(problem)
  }
  const codeMoved = !original || original.code.xMm !== code.xMm || original.code.yMm !== code.yMm
  if (codeMoved && !(onGrid(code.xMm) && onGrid(code.yMm))) problems.push('The code must sit on the 0.5 mm grid.')
  const area = codeArea(code, size)
  const band = tapeBand(size)
  if (band && area.box.heightMm > band.bottomMm - band.topMm + ROUNDING_TOLERANCE) {
    problems.push(`The code with its quiet zone is taller than the printable band of ${size.heightMm} mm tape (${(band.bottomMm - band.topMm).toFixed(1)} mm).`)
  } else if (!area.fits) problems.push(band ? 'The code must be inside the printable band of the tape, at least 1 mm from the label ends.' : 'The code must be at least 1 mm inside the label.')

  template.texts.forEach((element, i) => {
    const name = `Line ${i + 1}`
    if (!TEXT_SIZE_CHOICES.includes(element.fontSizePt)) {
      problems.push(`${name} text size must be 6.5, 8 or 10 pt.`)
      return
    }
    const kept = original?.texts.find((text) => text.id === element.id)
    const moved = !kept || kept.xMm !== element.xMm || kept.yMm !== element.yMm
    if (moved && !(onGrid(element.xMm) && onGrid(element.yMm))) problems.push(`${name} must sit on the 0.5 mm grid.`)
    const box = textBox(element)
    if (!textFits(box, size)) problems.push(band ? `${name} must be inside the printable band of the tape, at least 1 mm from the label ends.` : `${name} must be at least 1 mm inside the label.`)
    if (overlaps(area.box, box)) problems.push(`${name} overlaps the code.`)
    if (element.mode === 'fixed') {
      const value = element.value ?? ''
      const problem = plainTextProblem(value, name)
      if (problem) problems.push(problem)
      else if (layOutText(element, value).scaleX < MIN_TEXT_SCALE) problems.push(`${name} is too long for this template.`)
    } else if (element.maxLength !== undefined && !(Number.isInteger(element.maxLength) && element.maxLength >= 1 && element.maxLength <= MAX_TEXT_LENGTH)) {
      problems.push(`${name} maximum length must be a whole number from 1 to ${MAX_TEXT_LENGTH}.`)
    }
  })
  return problems
}

/**
 * The designer's preview of `template`: a fixed code's data (else a sample), each fixed line's text
 * and each fill-in line as "Line N", whether or not the layout is valid yet. The code is drawn at its
 * largest, the size the designer's fit check allows for. On a Tape Size it reads along the tape,
 * shaded outside the printable band.
 */
export function templatePreviewSvg(template: Template, size: FitSize): string {
  const { code } = template
  const codeValue = code.mode === 'fixed' && code.value && !codeValueProblem(code.value) ? code.value : 'SAMPLE'
  const dpi = largestModuleResolution(code.moduleSize)
  const drawn = renderPlainCode(code.symbology, codeValue, code.moduleSize, dpi)
  const lines = template.texts.map((text, i) => layOutText(text, text.mode === 'fixed' ? (text.value ?? '') : `Line ${i + 1}`))
  const svg = labelSvgDocument(size, { ...drawn, ...placed(code, drawn, dpi) }, lines)
  const band = tapeBand(size)
  if (!band) return svg
  const shade = (yMm: number, heightMm: number): string =>
    `<rect x="0" y="${Number(yMm.toFixed(4))}" width="${size.widthMm}" height="${Number(heightMm.toFixed(4))}" fill="#98a2b3" fill-opacity="0.35"/>`
  return svg.replace(/<\/svg>$/, `${shade(0, band.topMm)}${shade(band.bottomMm, size.heightMm - band.bottomMm)}</svg>`)
}

/** Why code data cannot be printed, or null. */
function codeValueProblem(value: string): string | null {
  if (value === '') return 'Enter the code data.'
  if (value.length > MAX_CODE_LENGTH) return `The code data must be at most ${MAX_CODE_LENGTH} characters.`
  const problem = plainTextProblem(value, 'The code data')
  if (problem) return problem
  if (value.trim() !== value) return 'The code data cannot start or end with a space.'
  return null
}

function plainTextProblem(value: string, name: string): string | null {
  return PLAIN_CHARACTERS.test(value) ? null : `${name} may hold only ${PLAIN_CHARACTERS_TEXT}.`
}
