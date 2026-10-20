/**
 * The print job for a label: a one-page HTML document holding the label SVG at its real size, and
 * the options for a silent print. The Rust shell (`src-tauri/src/printing.rs`) prints the page with
 * them, so what reaches the driver is decided (and tested) here.
 *
 * Pure: no Node, DOM or Electron.
 */

import type { Label, LabelRequest } from '../core/label'
import { renderLabelSvg } from './labelSvg'
import type { PrintSettings } from './printSettings'

/** The subset of Electron's `WebContentsPrintOptions` a label print uses. */
export interface LabelPrintOptions {
  readonly silent: true
  readonly deviceName: string
  readonly printBackground: true
  readonly margins: { readonly marginType: 'none' }
  readonly landscape: false
  /** Custom page size in microns. */
  readonly pageSize: { readonly width: number; readonly height: number }
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

/** The print job for `label` (its copies) on this PC's printer and label roll. */
export function buildLabelPrintJob(label: Label, settings: PrintSettings): LabelPrintJob {
  const { widthMm, heightMm } = settings.labelSize
  const w = cssMm(widthMm)
  const h = cssMm(heightMm)
  const style =
    `@page{size:${w} ${h};margin:0}` +
    `html,body{margin:0;padding:0;width:${w};height:${h};overflow:hidden;background:white}` +
    `.label{width:${w};height:${h};transform:translate(${settings.offsetXmm.toFixed(4)}mm,${settings.offsetYmm.toFixed(4)}mm)}` +
    `.label svg{display:block}`
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">` +
    `<title>Label</title><style>${style}</style></head>` +
    `<body><div class="label">${renderLabelSvg(label, settings.labelSize)}</div></body></html>`

  return {
    html,
    options: {
      silent: true,
      deviceName: settings.printerName,
      printBackground: true,
      margins: { marginType: 'none' },
      landscape: false,
      pageSize: { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) },
      copies: label.copies,
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
