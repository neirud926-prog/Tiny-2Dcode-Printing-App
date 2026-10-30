/**
 * The 2D symbols, drawn by bwip-js as SVG: a GTIN Label's GS1 DataMatrix and a Custom Label's Plain code. No Electron and no DOM: this runs in
 * the renderer and in Node tests alike.
 */

// The default export: bwip-js's named `raw` export is the encoder for the "raw" symbology, not ToRaw.
import bwipjs from 'bwip-js'
import type { Label } from '../core/label'
import type { ModuleSize, Symbology } from '../core/template'

/** A PC's Printer resolution, in dots per inch. */
export type PrinterResolution = 203 | 300 | 360

export const PRINTER_RESOLUTIONS: readonly PrinterResolution[] = [203, 300, 360]

/** The pharmacy's label printers (Zebra GX420t), and settings saved before the resolution existed. */
export const DEFAULT_PRINTER_RESOLUTION: PrinterResolution = 203

/** One printer dot in mm at `dpi`. */
export function dotMm(dpi: PrinterResolution): number {
  return 25.4 / dpi
}

/**
 * A module size in whole printer dots at each resolution, so every module prints the same size and
 * Small, Medium and Large are about 0.35, 0.5 and 0.6 mm on every printer.
 */
export const MODULE_DOTS: Readonly<Record<PrinterResolution, Readonly<Record<ModuleSize, number>>>> = {
  203: { small: 3, medium: 4, large: 5 },
  300: { small: 4, medium: 6, large: 7 },
  360: { small: 5, medium: 7, large: 9 }
}

/** One module of `size` in mm at `dpi`: whole printer dots. */
export function moduleMm(size: ModuleSize, dpi: PrinterResolution): number {
  return MODULE_DOTS[dpi][size] * dotMm(dpi)
}

/** A GTIN Label's DataMatrix modules are always Medium. */
export const GTIN_MODULE_SIZE: ModuleSize = 'medium'

/** One printer dot in mm at the default 203 dpi. */
export const DOT_MM = dotMm(DEFAULT_PRINTER_RESOLUTION)

/** A GTIN Label's module in mm at 203 dpi: 4 dots ≈ 0.5005 mm. */
export const MODULE_MM = moduleMm(GTIN_MODULE_SIZE, DEFAULT_PRINTER_RESOLUTION)

/** The label data the symbol carries. */
export type SymbolData = Pick<Label, 'internalGtin' | 'expiryYymmdd' | 'lot'>

/**
 * The smallest symbol drawn: 20 × 20 Medium modules ≈ 10 mm (4 dots at 203 dpi = 10.0 mm), the label's 1 cm code. A Lot too
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

/** Draws the GS1 DataMatrix for a label, with Medium modules at `dpi`, {@link MIN_SYMBOL_SIZE} at least. */
export function renderDataMatrix(data: SymbolData, dpi: PrinterResolution): DataMatrixSymbol {
  const options = dataMatrixOptions(data)
  const module = moduleMm(GTIN_MODULE_SIZE, dpi)
  try {
    // BWIPP takes `version` (the symbol size) for DataMatrix; bwip-js's option types do not list it.
    return drawSymbol({ ...options, version: MIN_SYMBOL_SIZE } as DataMatrixOptions, module)
  } catch {
    // The data does not fit the minimum size: let bwip-js pick the smallest size that holds it.
    return drawSymbol(options, module)
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

/** Draws a Plain code with modules of `size`, whole printer dots at `dpi`. */
export function renderPlainCode(symbology: Symbology, text: string, size: ModuleSize, dpi: PrinterResolution): PlainCodeSymbol {
  const module = moduleMm(size, dpi)
  return { ...drawSymbol(plainCodeOptions(symbology, text), module), quietZoneMm: QUIET_ZONE_MODULES[symbology] * module }
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
