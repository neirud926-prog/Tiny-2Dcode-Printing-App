/**
 * The print job for a label: a one-page HTML document holding the label SVG at its real size, and
 * the options for a silent print. The Rust shell (`src-tauri/src/printing.rs`) prints the page with
 * them, so what reaches the driver is decided (and tested) here.
 *
 * Pure: no Node, DOM or Electron.
 */

import type { Label, LabelRequest } from '../core/label'
import { renderCustomLabelSvg, type CustomLabel } from './customLabel'
import { renderGtinLabelSvg } from './gtinTapeLabel'
import type { LabelSizeEntry, PrintSettings } from './printSettings'
import { renderTapeTestSvg } from './tapeSize'
import { renderTopupLabelSvg, type TopupLabel } from './topupLabel'

/** The subset of Electron's `WebContentsPrintOptions` a label print uses. */
export interface LabelPrintOptions {
  readonly silent: true
  readonly deviceName: string
  readonly printBackground: true
  readonly margins: { readonly marginType: 'none' }
  readonly landscape: false
  /**
   * Custom page size in microns; null means use the driver's paper (a Tape Size: the tape is set in
   * the driver's Printing preferences, ADR 0004).
   */
  readonly pageSize: { readonly width: number; readonly height: number } | null
  readonly copies: number
  readonly scaleFactor: 100
}

export interface LabelPrintJob {
  /** The page to print: the label alone, with no margins, scripts or outside resources. */
  readonly html: string
  readonly options: LabelPrintOptions
}

/** The page can run nothing and load nothing; its one inline `<style>` sets the page size. */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'"

/** The print job for `label` (its copies) on this PC's printer and label roll; on tape, in the GTIN tape layout. */
export function buildLabelPrintJob(label: Label, settings: PrintSettings): LabelPrintJob {
  return printJobFor(renderGtinLabelSvg(label, settings.labelSize, settings.printerResolution), label.copies, settings)
}

/** The print job for a Custom Label (its copies) on this PC's printer, with the offsets for its size. */
export function buildCustomLabelPrintJob(label: CustomLabel, settings: PrintSettings): LabelPrintJob {
  return printJobFor(renderCustomLabelSvg(label), label.copies, settings)
}

/** The print job for a Topup Label (its copies) on this PC's printer, on the built-in Tape Size "24 mm tape × 26 mm". */
export function buildTopupLabelPrintJob(label: TopupLabel, settings: PrintSettings): LabelPrintJob {
  return printJobFor(renderTopupLabelSvg(label), label.copies, settings)
}

/** The Test print on a Tape Size: its outline, printable band edges and name, one copy. */
export function buildTapeTestPrintJob(size: LabelSizeEntry, settings: PrintSettings): LabelPrintJob {
  return printJobFor(renderTapeTestSvg(size), 1, settings)
}

/**
 * On tape the page is the driver's portrait paper, as wide as the tape, so the label (length ×
 * tape width) is turned a quarter turn clockwise to run along it; the offsets still move it along
 * the label's own x and y.
 */
function printJobFor(svg: string, copies: number, settings: PrintSettings): LabelPrintJob {
  const { widthMm, heightMm } = settings.labelSize
  const w = cssMm(widthMm)
  const h = cssMm(heightMm)
  const offset = `translate(${settings.offsetXmm.toFixed(4)}mm,${settings.offsetYmm.toFixed(4)}mm)`
  const onTape = settings.labelSize.kind === 'tape'
  const style =
    (onTape
      ? `@page{margin:0}` +
        `html,body{margin:0;padding:0;width:${h};height:${w};overflow:hidden;background:white}` +
        `.label{width:${w};height:${h};transform-origin:0 0;transform:translate(${h},0) rotate(90deg) ${offset}}`
      : `@page{size:${w} ${h};margin:0}` +
        `html,body{margin:0;padding:0;width:${w};height:${h};overflow:hidden;background:white}` +
        `.label{width:${w};height:${h};transform:${offset}}`) +
    `.label svg{display:block}`
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">` +
    `<title>Label</title><style>${style}</style></head>` +
    `<body><div class="label">${svg}</div></body></html>`

  return {
    html,
    options: {
      silent: true,
      deviceName: settings.printerName,
      printBackground: true,
      margins: { marginType: 'none' },
      landscape: false,
      pageSize: onTape ? null : { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) },
      copies,
      scaleFactor: 100
    }
  }
}

/** A page as a `data:` URL, so the hidden print window loads it without touching the disk. */
export function htmlDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * The label a test print uses: Item Code `TEST01`, Lot `TEST`, Expiry the 1st of this month next
 * year (always a real date and never short-dated), one copy. `today` is `yyyy-mm-dd`.
 */
export function sampleLabelRequest(today: string): LabelRequest {
  const [year, month] = today.split('-')
  return { itemCode: 'TEST01', packVolumeDigit: 0, expiry: `01${month}${Number(year) + 1}`, lot: 'TEST', copies: 1 }
}

/** A length in mm for CSS, without trailing zeros (`34.4mm`, `25mm`). */
function cssMm(value: number): string {
  return `${Number(value.toFixed(4))}mm`
}
