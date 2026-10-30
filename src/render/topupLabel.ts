/**
 * The Topup Label (GLOSSARY): its code holds the Topup Database entry's `<drug>` content, with the
 * Item Code in 8 pt bold under it, on the built-in Tape Size "24 mm tape × 26 mm". Laid out as it
 * reads along the tape: the 26 mm length across (x), the tape width up and down (y).
 *
 *   ┌──────────────────────────┐ ← tape edge
 *   │ - - - - - - - - - - - - -│ ← printable band
 *   │        ▛▀▀▀▀▀▀▀▜         │   the smallest QR (ECC L) or square DataMatrix that holds
 *   │        ▌  code  ▐         │   the content, at the largest whole-dot module up to 0.5 mm
 *   │        ▙▄▄▄▄▄▄▄▟         │   that fits with its quiet zone and the Item Code line;
 *   │          DIPH32           │   the block centred on the label
 *   │ - - - - - - - - - - - - -│
 *   └──────────────────────────┘
 *
 * Built the same way on screen (preview) and in the app service (the last gate before the printer).
 * Pure: no Node, DOM or Electron.
 */

import { MAX_COPIES, MIN_COPIES } from '../core/label'
import type { Symbology } from '../core/template'
import { dotMm, renderTopupCode, QUIET_ZONE_MODULES, type PlainCodeSymbol, type PrinterResolution } from './dataMatrix'
import { capHeightMm, descentMm, labelSvgDocument, line, ROUNDING_TOLERANCE, run, snapToDot, type LabelSize, type TextLine } from './labelSvg'
import { TOPUP_TAPE_SIZE } from './printSettings'
import { printableBandMm, type TapeWidthMm } from './tapeSize'

/** The Template name a Topup Label is logged under. */
export const TOPUP_TEMPLATE_NAME = 'Topup'
export const TOPUP_TEXT_PT = 8
export const MAX_TOPUP_MODULE_MM = 0.5
export const MIN_TOPUP_MODULE_MM = 0.25

/** Why a Topup Label is refused on any Label Size but the built-in Topup tape. */
export const TOPUP_LABEL_SIZE_REFUSAL = `Topup Labels print only on the built-in Tape Size "${TOPUP_TAPE_SIZE.name}". Change the label in Settings.`

/** What a Topup Label is made from: the Item Code, its code content (`topupContent`), the code type and copies. */
export interface TopupLabelInput {
  readonly itemCode: string
  readonly content: string
  readonly symbology: Symbology
  readonly copies: number
}

export interface TopupLabel extends TopupLabelInput {
  readonly size: LabelSize
  /** The module in whole printer dots at the PC's Printer resolution, and in mm. */
  readonly moduleDots: number
  readonly moduleMm: number
  readonly symbol: PlainCodeSymbol & { readonly xMm: number; readonly yMm: number }
  /** The Item Code line. */
  readonly line: TextLine
}

export type BuildTopupLabelResult = { ok: true; label: TopupLabel } | { ok: false; message: string }

/** Printable ASCII: the workbook's content passed through the online QR service as these bytes. */
const PLAIN_ASCII = /^[\x20-\x7e]*$/

/** Lays out the Topup Label for a printer of `dpi` (the PC's Printer resolution). */
export function buildTopupLabel(input: TopupLabelInput, dpi: PrinterResolution): BuildTopupLabelResult {
  const { copies } = input
  if (!Number.isInteger(copies) || copies < MIN_COPIES || copies > MAX_COPIES) {
    return { ok: false, message: `Copies must be a whole number from ${MIN_COPIES} to ${MAX_COPIES}.` }
  }
  if (!PLAIN_ASCII.test(input.content)) return { ok: false, message: 'The code content holds a character other than plain ASCII, so it is not printed.' }

  const size = { widthMm: TOPUP_TAPE_SIZE.widthMm, heightMm: TOPUP_TAPE_SIZE.heightMm }
  const band = printableBandMm(size.heightMm as TapeWidthMm)
  const textHeightMm = capHeightMm(TOPUP_TEXT_PT) + descentMm(TOPUP_TEXT_PT)
  const modules = renderTopupCode(input.symbology, input.content, 1).columns + 2 * QUIET_ZONE_MODULES[input.symbology]

  const dot = dotMm(dpi)
  const fits = (moduleMm: number): boolean =>
    modules * moduleMm <= size.widthMm + ROUNDING_TOLERANCE && modules * moduleMm + textHeightMm <= band.bottomMm - band.topMm + ROUNDING_TOLERANCE
  let moduleDots = Math.floor(MAX_TOPUP_MODULE_MM / dot + ROUNDING_TOLERANCE)
  while (moduleDots * dot >= MIN_TOPUP_MODULE_MM - ROUNDING_TOLERANCE && !fits(moduleDots * dot)) moduleDots--
  const moduleMm = moduleDots * dot
  if (moduleMm < MIN_TOPUP_MODULE_MM - ROUNDING_TOLERANCE) {
    return { ok: false, message: `The code is too big for ${size.heightMm} mm tape: it fits only with modules under ${MIN_TOPUP_MODULE_MM} mm.` }
  }

  const drawn = renderTopupCode(input.symbology, input.content, moduleMm)
  const blockTop = (size.heightMm - (modules * moduleMm + textHeightMm)) / 2
  const symbol = {
    ...drawn,
    xMm: snapToDot((size.widthMm - drawn.widthMm) / 2, dpi),
    yMm: snapToDot(blockTop + drawn.quietZoneMm, dpi)
  }
  const baselineMm = symbol.yMm + drawn.heightMm + drawn.quietZoneMm + capHeightMm(TOPUP_TEXT_PT)
  const unplaced = line([run(input.itemCode, TOPUP_TEXT_PT, true)], 0, baselineMm, size.widthMm)
  const centred = { ...unplaced, xMm: symbol.xMm + (drawn.widthMm - unplaced.widthMm) / 2 }

  return { ok: true, label: { ...input, size, moduleDots, moduleMm, symbol, line: centred } }
}

/** The label as a self-contained SVG document. */
export function renderTopupLabelSvg(label: TopupLabel): string {
  return labelSvgDocument(label.size, label.symbol, [label.line])
}
