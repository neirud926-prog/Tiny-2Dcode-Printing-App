/**
 * Label layout and SVG. The label is one self-contained SVG sized in mm: it is shown scaled up as the
 * on-screen preview and, later, printed from a hidden window. No Electron and no DOM: text widths are
 * estimated from font metrics, so the same layout is produced in the renderer and in Node tests.
 *
 *   ┌──────────────────────────────────┐
 *   │ ▛▀▀▀▜  PARA18 60 mL              │   Item Code and Pack Volume bold 6.5 pt, as the Lot
 *   │ ▌ DM ▐  EXP 31 DEC 2027          │   6.5 pt, "EXP" bold; the symbol is 1 cm square
 *   │ ▙▄▄▄▟  LOT 2512172-1             │   6.5 pt, "LOT" bold; past 15 characters the Lot
 *   └──────────────────────────────────┘   moves to its own full-width line under this row
 */

import type { Label } from '../core/label'
import { DEFAULT_PRINTER_RESOLUTION, dotMm, renderDataMatrix, type DataMatrixSymbol, type PrinterResolution } from './dataMatrix'
import { MM_PER_PT, textWidthMm } from './textMetrics'

export interface LabelSize {
  readonly widthMm: number
  readonly heightMm: number
}

/** The Zebra GX420t's default label roll. */
export const DEFAULT_LABEL_SIZE: LabelSize = { widthMm: 34.4, heightMm: 25 }

export const SIDE_PADDING_MM = 1.5
export const SYMBOL_TEXT_GAP_MM = 1.2
/** A Lot longer than this many characters moves to its own line, so it is never cut off. */
export const LOT_OWN_LINE_AFTER = 15
export const FONT_FAMILY = 'Arial, Helvetica, sans-serif'

export const DETAIL_PT = 6.5
const ITEM_CODE_PT = DETAIL_PT
const PACK_VOLUME_PT = DETAIL_PT
const PACK_VOLUME_GAP_MM = 0.7
/** Baseline to baseline between the Item Code, EXP and LOT lines. */
export const DETAIL_LINE_PITCH_MM = DETAIL_PT * MM_PER_PT * 1.25
/** From the bottom of the symbol row to the top of a Lot on its own line (well over one module of quiet zone). */
const OWN_LINE_GAP_MM = 1.0
/** Arial / Helvetica capital height and descent, in em. */
const CAP_HEIGHT_EM = 0.716
const DESCENT_EM = 0.212
/** Estimated widths are padded by this factor, so real text stays inside its line. */
export const WIDTH_SAFETY = 1.03

export interface TextRun {
  readonly text: string
  readonly fontSizePt: number
  readonly bold: boolean
  /** Extra space before this run, in mm. */
  readonly gapBeforeMm: number
}

export interface TextLine {
  readonly runs: readonly TextRun[]
  readonly xMm: number
  readonly baselineMm: number
  /** Top of the line's capitals. */
  readonly topMm: number
  /** Bottom of the line's descenders. */
  readonly bottomMm: number
  /** Estimated natural width, padded for safety. */
  readonly widthMm: number
  readonly maxWidthMm: number
  /** Horizontal squeeze applied so the line fits: 1 means none. */
  readonly scaleX: number
}

export interface LabelLayout {
  readonly size: LabelSize
  readonly symbol: DataMatrixSymbol & { readonly xMm: number; readonly yMm: number }
  readonly itemCodeLine: TextLine
  readonly expiryLine: TextLine
  readonly lotLine: TextLine
  readonly lotOnOwnLine: boolean
  /** Vertical extent of everything printed; centred on the label. */
  readonly content: { readonly topMm: number; readonly bottomMm: number }
}

/** Positions the symbol and text of a label on a label of the given size, for a printer of `dpi`. */
export function layoutLabel(label: Label, size: LabelSize = DEFAULT_LABEL_SIZE, dpi: PrinterResolution = DEFAULT_PRINTER_RESOLUTION): LabelLayout {
  const dataMatrix = renderDataMatrix(label, dpi)
  const lotOnOwnLine = label.lot.length > LOT_OWN_LINE_AFTER
  const { itemCodeRuns, expiryRuns, lotRuns } = gtinTextRuns(label)

  // Text block beside the symbol, as offsets from its top.
  const itemCodeBaseline = capHeightMm(ITEM_CODE_PT)
  const expiryBaseline = itemCodeBaseline + DETAIL_LINE_PITCH_MM
  const sideLotBaseline = expiryBaseline + DETAIL_LINE_PITCH_MM
  const blockHeight = (lotOnOwnLine ? expiryBaseline : sideLotBaseline) + descentMm(DETAIL_PT)

  const rowHeight = Math.max(dataMatrix.heightMm, blockHeight)
  const ownLineHeight = lotOnOwnLine ? OWN_LINE_GAP_MM + capHeightMm(DETAIL_PT) + descentMm(DETAIL_PT) : 0
  const contentHeight = rowHeight + ownLineHeight

  // The symbol sits on whole printer dots, so its modules print exactly the same dots each.
  const contentTop = snapToDot((size.heightMm - contentHeight) / 2, dpi)
  const symbolX = snapToDot(SIDE_PADDING_MM, dpi)
  const symbolY = contentTop + floorToDot((rowHeight - dataMatrix.heightMm) / 2, dpi)
  const blockTop = contentTop + (rowHeight - blockHeight) / 2

  const textX = symbolX + dataMatrix.widthMm + SYMBOL_TEXT_GAP_MM
  const sideMaxWidth = size.widthMm - SIDE_PADDING_MM - textX
  const lotLine = lotOnOwnLine
    ? line(lotRuns, SIDE_PADDING_MM, contentTop + rowHeight + OWN_LINE_GAP_MM + capHeightMm(DETAIL_PT), size.widthMm - 2 * SIDE_PADDING_MM)
    : line(lotRuns, textX, blockTop + sideLotBaseline, sideMaxWidth)

  return {
    size,
    symbol: { ...dataMatrix, xMm: symbolX, yMm: symbolY },
    itemCodeLine: line(itemCodeRuns, textX, blockTop + itemCodeBaseline, sideMaxWidth),
    expiryLine: line(expiryRuns, textX, blockTop + expiryBaseline, sideMaxWidth),
    lotLine,
    lotOnOwnLine,
    content: { topMm: contentTop, bottomMm: contentTop + contentHeight }
  }
}

/** The text of a GTIN Label: Item Code + Pack Volume (bold), EXP and LOT lines, all 6.5 pt. */
export function gtinTextRuns(label: Label): { itemCodeRuns: TextRun[]; expiryRuns: TextRun[]; lotRuns: TextRun[] } {
  const itemCodeRuns: TextRun[] = [run(label.itemCode, ITEM_CODE_PT, true)]
  if (label.packVolumeText !== null) itemCodeRuns.push(run(label.packVolumeText, PACK_VOLUME_PT, true, PACK_VOLUME_GAP_MM))
  return {
    itemCodeRuns,
    expiryRuns: [run('EXP', DETAIL_PT, true), run(` ${label.expiryText}`, DETAIL_PT, false)],
    lotRuns: [run('LOT', DETAIL_PT, true), run(` ${label.lot}`, DETAIL_PT, false)]
  }
}

/** The label as a self-contained SVG document, `widthMm` × `heightMm` in size, for a printer of `dpi`. */
export function renderLabelSvg(label: Label, size: LabelSize = DEFAULT_LABEL_SIZE, dpi: PrinterResolution = DEFAULT_PRINTER_RESOLUTION): string {
  const layout = layoutLabel(label, size, dpi)
  return labelSvgDocument(size, layout.symbol, [layout.itemCodeLine, layout.expiryLine, layout.lotLine])
}

/**
 * A label as one self-contained SVG: white, the symbol (on whole printer dots) and the text lines,
 * all with presentation attributes, nothing loaded from outside. Shared by GTIN and Custom Labels.
 */
export function labelSvgDocument(size: LabelSize, symbol: DataMatrixSymbol & { readonly xMm: number; readonly yMm: number }, lines: readonly TextLine[]): string {
  const w = String(size.widthMm)
  const h = String(size.heightMm)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" ` +
    `font-family="${FONT_FAMILY}" xml:space="preserve">` +
    `<rect width="${w}" height="${h}" fill="white"/>` +
    `<svg x="${mm(symbol.xMm)}" y="${mm(symbol.yMm)}" width="${mm(symbol.widthMm)}" height="${mm(symbol.heightMm)}" ` +
    `viewBox="${symbol.viewBox}" shape-rendering="crispEdges">${symbol.markup}</svg>` +
    lines.map(textLineSvg).join('') +
    `</svg>`
  )
}

function textLineSvg(line: TextLine): string {
  const position =
    line.scaleX < 1
      ? `transform="translate(${mm(line.xMm)} ${mm(line.baselineMm)}) scale(${line.scaleX.toFixed(4)} 1)"`
      : `x="${mm(line.xMm)}" y="${mm(line.baselineMm)}"`
  const runs = line.runs
    .map((run) => {
      const dx = run.gapBeforeMm > 0 ? ` dx="${mm(run.gapBeforeMm)}"` : ''
      const weight = run.bold ? 'bold' : 'normal'
      return `<tspan font-size="${mm(run.fontSizePt * MM_PER_PT)}" font-weight="${weight}"${dx}>${escapeXml(run.text)}</tspan>`
    })
    .join('')
  return `<text ${position}>${runs}</text>`
}

export function run(text: string, fontSizePt: number, bold: boolean, gapBeforeMm = 0): TextRun {
  return { text, fontSizePt, bold, gapBeforeMm }
}

/** A line of text runs at `xMm`, squeezed across if wider than `maxWidthMm`. */
export function line(runs: TextRun[], xMm: number, baselineMm: number, maxWidthMm: number): TextLine {
  const naturalWidth = runs.reduce((sum, r) => sum + r.gapBeforeMm + textWidthMm(r.text, r.fontSizePt, r.bold), 0)
  const widthMm = naturalWidth * WIDTH_SAFETY
  const largestPt = Math.max(...runs.map((r) => r.fontSizePt))
  return {
    runs,
    xMm,
    baselineMm,
    topMm: baselineMm - capHeightMm(largestPt),
    bottomMm: baselineMm + descentMm(largestPt),
    widthMm,
    maxWidthMm,
    scaleX: widthMm > maxWidthMm ? maxWidthMm / widthMm : 1
  }
}

export function capHeightMm(fontSizePt: number): number {
  return fontSizePt * MM_PER_PT * CAP_HEIGHT_EM
}

export function descentMm(fontSizePt: number): number {
  return fontSizePt * MM_PER_PT * DESCENT_EM
}

/** A position rounded to whole printer dots at `dpi`. */
export function snapToDot(mmValue: number, dpi: PrinterResolution): number {
  return Math.round(mmValue / dotMm(dpi)) * dotMm(dpi)
}

export function floorToDot(mmValue: number, dpi: PrinterResolution): number {
  return Math.floor(mmValue / dotMm(dpi) + 1e-9) * dotMm(dpi)
}

function mm(value: number): string {
  return value.toFixed(4)
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => XML_ESCAPES[character])
}
