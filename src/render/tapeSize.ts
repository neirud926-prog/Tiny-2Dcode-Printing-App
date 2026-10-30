/**
 * Tape Sizes (GLOSSARY): the TZe tape widths, the printable band on each, and the Test print for tape.
 * A tape label is laid out as its length (x) × the tape width (y), like any Label Size; only the
 * print page turns it to run along the tape (`printJob`).
 *
 * Pure: no Node, DOM or Electron.
 */

import { FONT_FAMILY } from './labelSvg'

/** The tape widths a cassette can hold, in mm. */
export const TAPE_WIDTHS_MM = [3.5, 6, 9, 12, 18, 24, 36] as const
export type TapeWidthMm = (typeof TAPE_WIDTHS_MM)[number]

/** The printable band across each tape width, in P900-series dots at 360 dpi; centred on the tape. */
const BAND_DOTS: Readonly<Record<TapeWidthMm, number>> = { 3.5: 48, 6: 64, 9: 106, 12: 150, 18: 234, 24: 320, 36: 454 }
const BAND_DPI = 360

export function isTapeWidthMm(value: unknown): value is TapeWidthMm {
  return TAPE_WIDTHS_MM.includes(value as TapeWidthMm)
}

/** The printable band on a tape: from `topMm` to `bottomMm` across the tape width. */
export function printableBandMm(tapeWidthMm: TapeWidthMm): { topMm: number; bottomMm: number } {
  const bandMm = (BAND_DOTS[tapeWidthMm] * 25.4) / BAND_DPI
  const topMm = (tapeWidthMm - bandMm) / 2
  return { topMm, bottomMm: topMm + bandMm }
}

/** e.g. `24 mm tape × 40 mm`. */
export function tapeSizeName(tapeWidthMm: number, lengthMm: number): string {
  return `${tapeWidthMm} mm tape × ${lengthMm} mm`
}

/** The Test print on a Tape Size: the label outline, the printable band edges and the size name. */
export function renderTapeTestSvg(size: { readonly name: string; readonly widthMm: number; readonly heightMm: number }): string {
  const { widthMm: w, heightMm: h } = size
  const band = isTapeWidthMm(h) ? printableBandMm(h) : { topMm: 0, bottomMm: h }
  const line = 0.2
  const fontMm = Math.min(2.5, (band.bottomMm - band.topMm) * 0.6)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">` +
    `<rect x="${line / 2}" y="${line / 2}" width="${round(w - line)}" height="${round(h - line)}" fill="none" stroke="black" stroke-width="${line}"/>` +
    `<line x1="0" y1="${round(band.topMm)}" x2="${w}" y2="${round(band.topMm)}" stroke="black" stroke-width="${line}" stroke-dasharray="1 0.5"/>` +
    `<line x1="0" y1="${round(band.bottomMm)}" x2="${w}" y2="${round(band.bottomMm)}" stroke="black" stroke-width="${line}" stroke-dasharray="1 0.5"/>` +
    `<text x="${w / 2}" y="${round(h / 2 + fontMm * 0.35)}" font-family="${FONT_FAMILY}" font-size="${round(fontMm)}" text-anchor="middle">${escapeXml(size.name)}</text>` +
    `</svg>`
  )
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
