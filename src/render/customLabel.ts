/**
 * A Custom Label from a Template: the checks on what staff typed, the layout and the SVG. Built the
 * same way on screen (live preview and field messages) and in the app service (the last gate before
 * the printer), with the GTIN Label's text and SVG helpers.
 *
 * Pure: no Node, DOM or Electron.
 */

import { MAX_COPIES, MIN_COPIES } from '../core/label'
import { MAX_CODE_LENGTH, PLAIN_CHARACTERS, PLAIN_CHARACTERS_TEXT, type Symbology, type Template } from '../core/template'
import { renderPlainCode, type PlainCodeSymbol } from './dataMatrix'
import { capHeightMm, labelSvgDocument, line, run, snapToDot, type LabelSize, type TextLine } from './labelSvg'
import { formatLabelSizeMm, type LabelSizeEntry } from './printSettings'

/** Text squeezed narrower than this share of its width is refused instead. */
export const MIN_TEXT_SCALE = 0.7
/** The code (with its quiet zone) and the text stay at least this far inside the label. */
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

/** Checks what staff typed against `template` on a label of `size`, and lays the label out. */
export function buildCustomLabel(template: Template, size: LabelSize, input: CustomLabelInput): BuildCustomLabelResult {
  const errors: CustomFieldMessage[] = []

  const codeValue = template.code.mode === 'fixed' ? (template.code.value ?? '') : input.codeValue
  const codeProblem = plainTextProblem(codeValue, 'The code data')
  if (codeValue === '') errors.push({ field: 'code', message: 'Enter the code data.' })
  else if (codeValue.length > MAX_CODE_LENGTH) errors.push({ field: 'code', message: `The code data must be at most ${MAX_CODE_LENGTH} characters.` })
  else if (codeProblem) errors.push({ field: 'code', message: codeProblem })
  else if (codeValue.trim() !== codeValue) errors.push({ field: 'code', message: 'The code data cannot start or end with a space.' })

  const fillCount = template.texts.filter((text) => text.mode === 'fill').length
  if (input.texts.length !== fillCount) return { ok: false, errors: [...errors, { field: 'template', message: 'The text lines do not match this template.' }] }
  let fill = 0
  const texts = template.texts.map((text) => (text.mode === 'fixed' ? (text.value ?? '') : input.texts[fill++]))

  const lines = template.texts.map((element, i) => {
    const field: CustomLabelField = `line${i + 1}`
    const name = `Line ${i + 1}`
    const value = texts[i]
    const problem = plainTextProblem(value, name)
    if (problem) errors.push({ field, message: problem })
    else if (element.maxLength !== undefined && value.length > element.maxLength) errors.push({ field, message: `${name} must be at most ${element.maxLength} characters.` })

    const laidOut = line([run(value, element.fontSizePt, element.bold)], element.xMm, element.yMm + capHeightMm(element.fontSizePt), element.widthMm)
    if (!problem && laidOut.scaleX < MIN_TEXT_SCALE) errors.push({ field, message: `${name} is too long for this template.` })
    const centred = element.align === 'center' && laidOut.scaleX === 1
    return centred ? { ...laidOut, xMm: element.xMm + (element.widthMm - laidOut.widthMm) / 2 } : laidOut
  })

  const { copies } = input
  if (!Number.isInteger(copies) || copies < MIN_COPIES || copies > MAX_COPIES) {
    errors.push({ field: 'copies', message: `Copies must be a whole number from ${MIN_COPIES} to ${MAX_COPIES}.` })
  }

  if (errors.length > 0) return { ok: false, errors }

  // The modules sit on whole printer dots; the code is the same size whatever its data.
  const drawn = renderPlainCode(input.symbology, codeValue, template.code.dotsPerModule)
  const symbol = { ...drawn, xMm: snapToDot(template.code.xMm - drawn.widthMm / 2), yMm: snapToDot(template.code.yMm - drawn.heightMm / 2) }
  const margin = Math.max(MIN_EDGE_MM, symbol.quietZoneMm) - 1e-9
  const fits =
    symbol.xMm >= margin && symbol.yMm >= margin && symbol.xMm + symbol.widthMm <= size.widthMm - margin && symbol.yMm + symbol.heightMm <= size.heightMm - margin
  if (!fits) return { ok: false, errors: [{ field: 'template', message: 'The code does not fit inside the label at its position.' }] }

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

function plainTextProblem(value: string, name: string): string | null {
  return PLAIN_CHARACTERS.test(value) ? null : `${name} may hold only ${PLAIN_CHARACTERS_TEXT}.`
}
