/**
 * Advance widths for estimating how wide label text prints, without a DOM (the renderer also runs
 * in Node tests). Values are Helvetica / Helvetica-Bold AFM widths in 1/1000 em; Arial shares them.
 * Only characters that can appear on a label (GTIN or Custom) are listed; anything else counts as a full em, so an
 * estimate errs wide and text is squeezed rather than cut off.
 */

const REGULAR: Readonly<Record<string, number>> = {
  ...sameWidth('0123456789', 556),
  ' ': 278,
  '&': 667,
  '(': 333,
  ')': 333,
  '-': 333,
  '.': 278,
  '/': 278,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '_': 556,
  ':': 278,
  '#': 556,
  '+': 584,
  '*': 389,
  ...widths('abcdefghijklmnopqrstuvwxyz', [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500])
}

const BOLD: Readonly<Record<string, number>> = {
  ...REGULAR,
  '&': 722,
  A: 722,
  B: 722,
  J: 556,
  K: 722,
  L: 611,
  ':': 333,
  ...widths('abcdefghijklmnopqrstuvwxyz', [556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500])
}

const UNKNOWN_CHARACTER_WIDTH = 1000

/** Points to millimetres. */
export const MM_PER_PT = 25.4 / 72

/** Estimated advance width in mm of `text` set in Arial/Helvetica at `fontSizePt`. */
export function textWidthMm(text: string, fontSizePt: number, bold: boolean): number {
  const widths = bold ? BOLD : REGULAR
  let thousandths = 0
  for (const character of text) thousandths += widths[character] ?? UNKNOWN_CHARACTER_WIDTH
  return (thousandths / 1000) * fontSizePt * MM_PER_PT
}

function widths(characters: string, values: readonly number[]): Record<string, number> {
  return Object.fromEntries([...characters].map((character, i) => [character, values[i]]))
}

function sameWidth(characters: string, width: number): Record<string, number> {
  return Object.fromEntries([...characters].map((character) => [character, width]))
}
