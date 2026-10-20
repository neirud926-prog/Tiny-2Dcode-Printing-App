/**
 * The 2D symbols, drawn by bwip-js as SVG: a GTIN Label's GS1 DataMatrix and a Custom Label's Plain code. No Electron and no DOM: this runs in
 * the renderer and in Node tests alike.
 */

// The default export: bwip-js's named `raw` export is the encoder for the "raw" symbology, not ToRaw.
import bwipjs from 'bwip-js'
import type { Label } from '../core/label'
import type { Symbology } from '../core/template'

/** The label printer's resolution (Zebra GX420t). */
export const PRINTER_DPI = 203

/** One DataMatrix module is exactly this many printer dots, so every module prints the same size. */
export const DOTS_PER_MODULE = 4

/** One printer dot in mm. */
export const DOT_MM = 25.4 / PRINTER_DPI

/** One DataMatrix module in mm: 4 dots at 203 dpi ≈ 0.5005 mm. */
export const MODULE_MM = DOTS_PER_MODULE * DOT_MM

/** The label data the symbol carries. */
export type SymbolData = Pick<Label, 'internalGtin' | 'expiryYymmdd' | 'lot'>

/**
 * The smallest symbol drawn: 20 × 20 modules × 4 dots = 10.0 mm, the label's 1 cm code. A Lot too
 * long for it (about 10 letters or more) gets the next size, 22 × 22 = 11.0 mm.
 */
export const MIN_SYMBOL_SIZE = '20x20'

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

/** Draws the GS1 DataMatrix for a label, sized at {@link MODULE_MM} per module, {@link MIN_SYMBOL_SIZE} at least. */
export function renderDataMatrix(data: SymbolData): DataMatrixSymbol {
  const options = dataMatrixOptions(data)
  try {
    // BWIPP takes `version` (the symbol size) for DataMatrix; bwip-js's option types do not list it.
    return drawSymbol({ ...options, version: MIN_SYMBOL_SIZE } as DataMatrixOptions, MODULE_MM)
  } catch {
    // The data does not fit the minimum size: let bwip-js pick the smallest size that holds it.
    return drawSymbol(options, MODULE_MM)
  }
}

/** A Plain code drawn: also its quiet zone, the clear margin it needs on every side. */
export interface PlainCodeSymbol extends DataMatrixSymbol {
  readonly quietZoneMm: number
}

/**
 * The bwip-js options for a Plain code: exactly `text`, no GS1 AIs (no `parse`, so `^` is not
 * special), always the size that holds 40 characters of the allowed set (all one codeword each in
 * ASCII mode or QR byte mode), so a Template's layout never depends on the data.
 */
export function plainCodeOptions(symbology: Symbology, text: string): { bcid: string; text: string; version: string; eclevel?: string } {
  return symbology === 'qr' ? { bcid: 'qrcode', text, version: '3', eclevel: 'M' } : { bcid: 'datamatrix', text, version: '26x26' }
}

/** Quiet zone in modules: DataMatrix 1, QR 4. */
const QUIET_ZONE_MODULES: Record<Symbology, number> = { datamatrix: 1, qr: 4 }

/** Draws a Plain code with each module `dotsPerModule` printer dots. */
export function renderPlainCode(symbology: Symbology, text: string, dotsPerModule: number): PlainCodeSymbol {
  const moduleMm = dotsPerModule * DOT_MM
  return { ...drawSymbol(plainCodeOptions(symbology, text), moduleMm), quietZoneMm: QUIET_ZONE_MODULES[symbology] * moduleMm }
}

function drawSymbol(options: { bcid: string; text: string }, moduleMm: number): DataMatrixSymbol {
  const { bcid, text, ...rest } = options
  const [matrix] = bwipjs.raw(bcid, text, rest as object)
  if (!matrix || !('pixx' in matrix)) throw new Error(`bwip-js returned no ${bcid}`)

  const svg = bwipjs.toSVG({ ...options, padding: 0 } as Parameters<typeof bwipjs.toSVG>[0])
  const match = /^<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)
  if (!match) throw new Error('Unexpected SVG from bwip-js')

  return {
    columns: matrix.pixx,
    rows: matrix.pixy,
    widthMm: matrix.pixx * moduleMm,
    heightMm: matrix.pixy * moduleMm,
    viewBox: match[1],
    markup: match[2].trim()
  }
}
