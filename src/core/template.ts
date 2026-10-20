/**
 * Templates: Custom Label layouts for one Label Size, with one Plain code and up to six lines of
 * text, each fixed (its value saved in the Template) or fill-in (typed when printing). Layouts 1
 * and 2 are built in, on the Small Label, read-only.
 *
 * Pure: no Node, DOM or Electron.
 */

import { SMALL_LABEL } from '../render/printSettings'

export type Symbology = 'datamatrix' | 'qr'
export type DotsPerModule = 3 | 4 | 5
export type TextSizePt = 6.5 | 8 | 10
/** `fixed`: the value is saved in the Template; `fill`: typed when printing. */
export type ElementMode = 'fixed' | 'fill'

export interface TemplateCode {
  /** The centre of the symbol, in mm from the label's top-left corner. */
  readonly xMm: number
  readonly yMm: number
  /** The default choice when printing; staff may switch DataMatrix / QR. */
  readonly symbology: Symbology
  /** One module is this many printer dots. */
  readonly dotsPerModule: DotsPerModule
  readonly mode: ElementMode
  /** The data of a fixed code. */
  readonly value?: string
}

export interface TemplateText {
  readonly id: string
  /** The top-left of the line's box, in mm; the box is `widthMm` wide and one line of text high. */
  readonly xMm: number
  readonly yMm: number
  readonly widthMm: number
  readonly align: 'left' | 'center'
  readonly fontSizePt: TextSizePt
  readonly bold: boolean
  readonly mode: ElementMode
  /** The text of a fixed line. */
  readonly value?: string
  /** At most this many characters may be typed. */
  readonly maxLength?: number
}

export interface Template {
  readonly id: string
  readonly name: string
  readonly labelSizeId: string
  readonly builtIn: boolean
  readonly code: TemplateCode
  /** Up to {@link MAX_TEXT_LINES}; "Line N" is the N-th. */
  readonly texts: readonly TemplateText[]
}

export const MAX_TEXT_LINES = 6
export const MAX_CODE_LENGTH = 40

/** What code data and text may hold: A–Z a–z 0–9, space and `- _ . / : # ( ) + *`. */
export const PLAIN_CHARACTERS = /^[A-Za-z0-9 \-_./:#()+*]*$/
export const PLAIN_CHARACTERS_TEXT = 'A–Z, a–z, 0–9, space and - _ . / : # ( ) + *'

function fillLine(id: string, xMm: number, yMm: number, widthMm: number, align: TemplateText['align'], fontSizePt: TextSizePt, maxLength: number): TemplateText {
  return { id, xMm, yMm, widthMm, align, fontSizePt, bold: false, mode: 'fill', maxLength }
}

/**
 * Layout 1 on the Small Label (34.4 × 25 mm): the code centred, one 8 pt line under it, up to 20
 * characters. The largest symbol (QR version 3 at 3 dots, 10.9 mm, with a 1.5 mm quiet zone)
 * ends at 15.9 mm, its quiet zone at 17.4 mm; the line's box is 17.5–20.1 mm.
 */
export const LAYOUT_1: Template = {
  id: 'layout-1',
  name: 'Layout 1',
  labelSizeId: SMALL_LABEL.id,
  builtIn: true,
  code: { xMm: 17.2, yMm: 10.5, symbology: 'datamatrix', dotsPerModule: 3, mode: 'fill' },
  texts: [fillLine('line-1', 1, 17.5, 32.4, 'center', 8, 20)]
}

/**
 * Layout 2 on the Small Label: the code on the left, up to four 6.5 pt lines to its right, up to 16
 * characters each. The largest symbol (QR, 10.9 mm) spans 1.6–12.4 mm across, its quiet zone to
 * 13.9 mm; the lines' boxes start at 14 mm and are 19.4 mm wide.
 */
export const LAYOUT_2: Template = {
  id: 'layout-2',
  name: 'Layout 2',
  labelSizeId: SMALL_LABEL.id,
  builtIn: true,
  code: { xMm: 7, yMm: 12.5, symbology: 'datamatrix', dotsPerModule: 3, mode: 'fill' },
  texts: [7, 10, 13, 16].map((yMm, i) => fillLine(`line-${i + 1}`, 14, yMm, 19.4, 'left', 6.5, 16))
}

export const BUILT_IN_TEMPLATES: readonly Template[] = [LAYOUT_1, LAYOUT_2]
