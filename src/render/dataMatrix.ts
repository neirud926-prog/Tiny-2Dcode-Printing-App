/**
 * GS1 DataMatrix symbol for a label, drawn by bwip-js as SVG. No Electron and no DOM: this runs in
 * the renderer and in Node tests alike.
 */

// The default export: bwip-js's named `raw` export is the encoder for the "raw" symbology, not ToRaw.
import bwipjs from 'bwip-js'
import type { Label } from '../core/label'

/** The label printer's resolution (Zebra GX420t). */
export const PRINTER_DPI = 203

/** One DataMatrix module is exactly this many printer dots, so every module prints the same size. */
export const DOTS_PER_MODULE = 3

/** One printer dot in mm. */
export const DOT_MM = 25.4 / PRINTER_DPI

/** One DataMatrix module in mm: 3 dots at 203 dpi ≈ 0.3754 mm. */
export const MODULE_MM = DOTS_PER_MODULE * DOT_MM

/** The label data the symbol carries. */
export type SymbolData = Pick<Label, 'internalGtin' | 'expiryYymmdd' | 'lot'>

export interface DataMatrixOptions {
  readonly bcid: 'gs1datamatrix'
  readonly text: string
  readonly parse: true
}

/**
 * bwip-js options for the symbol. The text is the bracketed form `(01)…(17)…(10)…`, except that a
 * parenthesis inside the Lot (allowed, e.g. `(B)A52921725A4`) would read as the start of an AI, so
 * it is written as the ordinal `^040` / `^041`, which bwip-js expands with `parse`.
 */
export function dataMatrixOptions(data: SymbolData): DataMatrixOptions {
  const lot = data.lot.replace(/\(/g, '^040').replace(/\)/g, '^041')
  return { bcid: 'gs1datamatrix', text: `(01)${data.internalGtin}(17)${data.expiryYymmdd}(10)${lot}`, parse: true }
}

export interface DataMatrixSymbol {
  /** Modules across and down (DataMatrix symbols here are square). */
  readonly columns: number
  readonly rows: number
  readonly widthMm: number
  readonly heightMm: number
  /** The `viewBox` of bwip-js's drawing, to scale `markup` into `widthMm` × `heightMm`. */
  readonly viewBox: string
  /** The drawing's SVG elements, without the outer `<svg>`. */
  readonly markup: string
}

/** Draws the GS1 DataMatrix for a label, sized at {@link MODULE_MM} per module. */
export function renderDataMatrix(data: SymbolData): DataMatrixSymbol {
  const options = dataMatrixOptions(data)
  const [matrix] = bwipjs.raw(options.bcid, options.text, { parse: options.parse })
  if (!matrix || !('pixx' in matrix)) throw new Error('bwip-js returned no DataMatrix')

  const svg = bwipjs.toSVG({ ...options, padding: 0 })
  const match = /^<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)
  if (!match) throw new Error('Unexpected SVG from bwip-js')

  return {
    columns: matrix.pixx,
    rows: matrix.pixy,
    widthMm: matrix.pixx * MODULE_MM,
    heightMm: matrix.pixy * MODULE_MM,
    viewBox: match[1],
    markup: match[2].trim()
  }
}
