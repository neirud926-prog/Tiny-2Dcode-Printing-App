/**
 * GTIN Labels on tape (GLOSSARY Small Label, Tape Size): which Label Sizes a GTIN Label prints on,
 * and the built-in layout for 18, 24 or 36 mm tape. Laid out as it reads along the tape: the label
 * length across (x), the tape width up and down (y).
 *
 *   ┌───────────────────────────────────────┐ ← tape edge
 *   │ - - - - - - - - - - - - - - - - - - - │ ← printable band
 *   │  ▛▀▀▀▜  PARA18 60 mL                  │   the GS1 DataMatrix, Medium modules (about 1 cm),
 *   │  ▌ DM ▐  EXP 31 DEC 2027              │   centred across the band; the same 6.5 pt lines
 *   │  ▙▄▄▄▟  LOT 2512172-1                 │   as the Small Label to its right, the Lot always
 *   │ - - - - - - - - - - - - - - - - - - - │   beside the code: a longer label needs more tape
 *   └───────────────────────────────────────┘
 *
 * Pure: no Node, DOM or Electron.
 */

import type { Label } from '../core/label'
import { renderDataMatrix, type PrinterResolution } from './dataMatrix'
import {
  capHeightMm,
  DETAIL_LINE_PITCH_MM,
  DETAIL_PT,
  descentMm,
  floorToDot,
  gtinTextRuns,
  labelSvgDocument,
  line,
  renderLabelSvg,
  SIDE_PADDING_MM,
  snapToDot,
  SYMBOL_TEXT_GAP_MM,
  type LabelLayout,
  type LabelSize
} from './labelSvg'
import { formatLabelSizeMm, SMALL_LABEL, type LabelSizeEntry, type LabelSizeKind } from './printSettings'

/** The tape widths a GTIN Label prints on: the 1 cm code with its quiet zone fits their band. */
export const GTIN_TAPE_WIDTHS_MM: readonly number[] = [18, 24, 36]

/** Why a GTIN Label is refused on any other Label Size. */
export const GTIN_LABEL_SIZE_REFUSAL = `GTIN Labels print on the Small Label (${formatLabelSizeMm(SMALL_LABEL)}) or on 18, 24 or 36 mm tape. Change the label in Settings.`

/** Whether a GTIN Label prints on a Label Size: the Small Label, or a Tape Size of 18, 24 or 36 mm. */
export function isGtinLabelSize(size: Pick<LabelSizeEntry, 'id' | 'kind' | 'heightMm'>): boolean {
  return size.id === SMALL_LABEL.id || (size.kind === 'tape' && GTIN_TAPE_WIDTHS_MM.includes(size.heightMm))
}

/** Why a GTIN Label cannot print on the Label Size `labelSizeId` (looked up in `sizes`), or null. */
export function gtinLabelSizeProblem(labelSizeId: string, sizes: readonly LabelSizeEntry[]): string | null {
  const size = sizes.find((entry) => entry.id === labelSizeId)
  return size && isGtinLabelSize(size) ? null : GTIN_LABEL_SIZE_REFUSAL
}

export interface GtinTapeLayout extends Omit<LabelLayout, 'lotOnOwnLine'> {
  /** The shortest label that holds the code and the text unsqueezed. */
  readonly minLengthMm: number
}

/** Positions the code and text of `label` on `size` (a Tape Size: length × tape width), for a printer of `dpi`. */
export function layoutGtinTapeLabel(label: Label, size: LabelSize, dpi: PrinterResolution): GtinTapeLayout {
  const symbol = renderDataMatrix(label, dpi)
  const { itemCodeRuns, expiryRuns, lotRuns } = gtinTextRuns(label)

  // The band is centred on the tape, so centring on the tape centres on the band.
  const symbolX = snapToDot(SIDE_PADDING_MM, dpi)
  const symbolY = floorToDot((size.heightMm - symbol.heightMm) / 2, dpi)

  const itemCodeBaseline = capHeightMm(DETAIL_PT)
  const blockHeight = itemCodeBaseline + 2 * DETAIL_LINE_PITCH_MM + descentMm(DETAIL_PT)
  const blockTop = (size.heightMm - blockHeight) / 2
  const textX = symbolX + symbol.widthMm + SYMBOL_TEXT_GAP_MM
  const maxWidth = size.widthMm - SIDE_PADDING_MM - textX

  const itemCodeLine = line(itemCodeRuns, textX, blockTop + itemCodeBaseline, maxWidth)
  const expiryLine = line(expiryRuns, textX, blockTop + itemCodeBaseline + DETAIL_LINE_PITCH_MM, maxWidth)
  const lotLine = line(lotRuns, textX, blockTop + itemCodeBaseline + 2 * DETAIL_LINE_PITCH_MM, maxWidth)
  const widest = Math.max(itemCodeLine.widthMm, expiryLine.widthMm, lotLine.widthMm)

  return {
    size: { widthMm: size.widthMm, heightMm: size.heightMm },
    symbol: { ...symbol, xMm: symbolX, yMm: symbolY },
    itemCodeLine,
    expiryLine,
    lotLine,
    content: { topMm: Math.min(symbolY, blockTop), bottomMm: Math.max(symbolY + symbol.heightMm, blockTop + blockHeight) },
    minLengthMm: textX + widest + SIDE_PADDING_MM
  }
}

/** Why `label` does not fit the loaded Tape Size's length, naming the minimum in whole mm; null if it fits or `size` is not tape. */
export function gtinTapeLengthProblem(label: Label, size: LabelSizeEntry, dpi: PrinterResolution): string | null {
  if (size.kind !== 'tape') return null
  const { minLengthMm } = layoutGtinTapeLabel(label, size, dpi)
  if (minLengthMm <= size.widthMm + 1e-9) return null
  return `This GTIN Label needs tape at least ${Math.ceil(minLengthMm - 1e-9)} mm long; the loaded Tape Size is ${size.widthMm} mm. Add a longer Tape Size in Settings.`
}

/** The GTIN Label as a self-contained SVG: the tape layout on a Tape Size, the Small Label layout otherwise. */
export function renderGtinLabelSvg(label: Label, size: LabelSize & { readonly kind?: LabelSizeKind }, dpi: PrinterResolution): string {
  if (size.kind !== 'tape') return renderLabelSvg(label, size, dpi)
  const layout = layoutGtinTapeLabel(label, size, dpi)
  return labelSvgDocument(size, layout.symbol, [layout.itemCodeLine, layout.expiryLine, layout.lotLine])
}
