/**
 * Scan-input parser: what staff type or scan into the Item Code field → the Item Code.
 *
 * Recognised, after a–z is upper-cased (ASCII only):
 *   - a plain Item Code: exactly 6 of the 40 Item Code characters (typed, or an out-patient
 *     dispensing-bag label, which carries just the Item Code), e.g. `AIR 01`;
 *   - a shelf label, in the shapes BCS reads: NLTH's QR `ITEMCODE_BIN_B<hash>aR` with a 4-character BIN,
 *     e.g. `PARA01_1C5A_BPh!oUCUb0SGI/13ZaR`, or another site's plain `ITEMCODE_BIN` with a BIN of 2–6
 *     characters other than `_` (9–13 characters in all; PMH has bins like `AA 9`);
 *   - an in-patient dispensing-bag label: exactly 13 characters, 4 letters or digits, the Item Code,
 *     3 letters or digits, e.g. `2607PIOG02A1B`. Thirteen digits is a manufacturer EAN-13 instead (no
 *     Item Code is all digits), so it is refused.
 * Anything else is refused with one message; nothing is guessed.
 *
 * Whitespace: CR, LF and Tab at either end are dropped first (a keyboard-wedge scanner sends them as
 * a suffix, and none is an Item Code character). A space is an Item Code character, so spaces inside
 * are always kept and the value is matched as it is first; only when that fails are the spaces around
 * it trimmed and the value matched again. So `PARA01 ` becomes `PARA01`, but `PARA0 ` (exactly 6
 * characters) stays as it is for the Item List lookup to judge, rather than being trimmed to a guess.
 *
 * Pure: no Node, DOM or Electron.
 */

import { ITEM_CODE_CHARACTERS, ITEM_CODE_LENGTH } from './internalGtin'

/** Where an Item Code came from: typed (or an out-patient dispensing-bag label), a shelf QR, or an in-patient dispensing-bag label. */
export type ScanSource = 'typed' | 'shelf-qr' | 'bag-label-ip'

export type ItemCodeFromScanResult = { ok: true; itemCode: string; source: ScanSource } | { ok: false; message: string }

export const NOT_RECOGNISED_MESSAGE = 'Not an Item Code, shelf label or dispensing-bag label.'

/** One of the 40 Item Code characters, as a character class (`-` escaped, or ` -&` would be a range). */
const ITEM_CODE_CHARACTER = `[${ITEM_CODE_CHARACTERS.replace(/[-\\\]^]/g, '\\$&')}]`
const ITEM_CODE = `(${ITEM_CODE_CHARACTER}{${ITEM_CODE_LENGTH}})`

const PLAIN_ITEM_CODE = new RegExp(`^${ITEM_CODE}$`)
/**
 * The shelf-label shapes BCS reads (its `classifyScanInput`), so a label BCS accepts is accepted here:
 * NLTH's QR `ITEMCODE_BIN_B<hash>aR` with exactly 4 BIN characters of any kind (`_B` at position 12),
 * and another site's plain `ITEMCODE_BIN` with 2–6 BIN characters other than `_` (PMH has `AA 9`).
 * Case-insensitive because the value is upper-cased before matching, which turns the `aR` tail into `AR`.
 */
const SHELF_QR_PREFIXED = new RegExp(`^${ITEM_CODE}_.{4}_B.+AR$`, 'is')
const SHELF_LABEL_PLAIN = new RegExp(`^${ITEM_CODE}_[^_]{2,6}$`, 'i')
/** 4 + Item Code + 3 = 13 characters. */
const IN_PATIENT_BAG_LABEL = new RegExp(`^[0-9A-Z]{4}${ITEM_CODE}[0-9A-Z]{3}$`)
const EAN_13 = /^[0-9]{13}$/

/** A wedge scanner's suffix (or prefix): never an Item Code character. */
const SCANNER_CONTROL_AT_ENDS = /^[\r\n\t]+|[\r\n\t]+$/g

/** The Item Code in a typed or scanned value, and where it came from; or why none was taken. */
export function itemCodeFromScan(raw: string): ItemCodeFromScanResult {
  const value = upperCaseAscii(raw.replace(SCANNER_CONTROL_AT_ENDS, ''))
  // Six spaces are six Item Code characters, but never an Item Code.
  const found = value.trim() === '' ? null : (match(value) ?? match(value.trim()))
  return found ?? { ok: false, message: NOT_RECOGNISED_MESSAGE }
}

function match(value: string): ItemCodeFromScanResult | null {
  const plain = PLAIN_ITEM_CODE.exec(value)
  if (plain) return { ok: true, itemCode: plain[1], source: 'typed' }
  const shelf = SHELF_QR_PREFIXED.exec(value) ?? SHELF_LABEL_PLAIN.exec(value)
  if (shelf) return { ok: true, itemCode: upperCaseAscii(shelf[1]), source: 'shelf-qr' }
  const bag = IN_PATIENT_BAG_LABEL.exec(value)
  if (bag && !EAN_13.test(value)) return { ok: true, itemCode: bag[1], source: 'bag-label-ip' }
  return null
}

/** Upper-cases ASCII a–z only: String.prototype.toUpperCase would turn e.g. "ı" into "I". */
function upperCaseAscii(value: string): string {
  return value.replace(/[a-z]/g, (letter) => letter.toUpperCase())
}
