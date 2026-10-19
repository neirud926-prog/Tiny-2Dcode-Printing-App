/**
 * Internal GTIN codec, scheme v1 (docs/adr/0002-internal-gtin-scheme-v1.md).
 *
 *   V | 0 4 | N N N N N N N N N N | C
 *   V   Pack Volume digit
 *   04  GS1 prefix for restricted circulation within a company
 *   N   Item Code as a base-40 number, zero-padded to 10 digits
 *   C   GS1 mod-10 check digit
 *
 * Pure: no Electron, no file access. Once labels are printed this scheme cannot change.
 */

/** The 40 characters an Item Code may contain; a character's index is its value. Fixed forever. */
export const ITEM_CODE_CHARACTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -&.'

export const ITEM_CODE_LENGTH = 6

/** GS1 prefix for restricted circulation within a company; never issued to manufacturers. */
export const INTERNAL_GTIN_PREFIX = '04'

/** 40⁶: the first N reserved for a future version. v1 never produces N at or above it. */
export const FIRST_RESERVED_ITEM_NUMBER = 4_096_000_000

export type PackVolumeDigit = 0 | 1 | 2 | 3 | 4 | 5
export type PackVolumeMl = 30 | 60 | 120 | 240 | 480

/**
 * Pack Volume digit V → nominal fill volume. Digit 0 means no volume is encoded (a non-liquid, or a
 * volume not listed). Digits 6–8 are reserved for future volumes (only by a new ADR); 9 is never used.
 */
export const PACK_VOLUMES: readonly { readonly digit: PackVolumeDigit; readonly ml: PackVolumeMl | null }[] = [
  { digit: 0, ml: null },
  { digit: 1, ml: 30 },
  { digit: 2, ml: 60 },
  { digit: 3, ml: 120 },
  { digit: 4, ml: 240 },
  { digit: 5, ml: 480 }
]

/** The Pack Volume digit for a volume in mL; 0 when there is no volume or it is not listed. */
export function packVolumeDigitForMl(ml: number | null): PackVolumeDigit {
  return PACK_VOLUMES.find((entry) => entry.ml !== null && entry.ml === ml)?.digit ?? 0
}

/** The nominal volume in mL for a Pack Volume digit; null for digit 0 (no volume encoded). */
export function packVolumeMlForDigit(digit: PackVolumeDigit): PackVolumeMl | null {
  return PACK_VOLUMES[digit].ml
}

function isPackVolumeDigit(value: number): value is PackVolumeDigit {
  return Number.isInteger(value) && value >= 0 && value < PACK_VOLUMES.length
}

/** GS1 mod-10 check digit for a digit string that excludes the check digit (e.g. 13 digits of a GTIN-14). */
export function gs1CheckDigit(digits: string): number {
  let sum = 0
  // Weights alternate 3, 1, 3, ... starting from the rightmost digit.
  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(digits.length - 1 - i) - 48
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

export type EncodeRefusal = 'item-code-length' | 'item-code-character' | 'pack-volume-digit'

export type EncodeInternalGtinResult =
  | { ok: true; internalGtin: string; itemCode: string; packVolumeDigit: PackVolumeDigit }
  | { ok: false; reason: EncodeRefusal; message: string }

/**
 * Encodes an Item Code and Pack Volume digit as a 14-digit Internal GTIN. Lower-case a–z is
 * upper-cased first; any other character outside the 40 is refused. The returned `itemCode` is
 * the upper-cased Item Code that was encoded.
 */
export function encodeInternalGtin(itemCode: string, packVolumeDigit: number): EncodeInternalGtinResult {
  if (itemCode.length !== ITEM_CODE_LENGTH) {
    return refuse('item-code-length', `Item Code must be exactly 6 characters; got ${itemCode.length}.`)
  }
  // Upper-case ASCII a–z only: String.prototype.toUpperCase would turn e.g. "ı" into "I".
  const upperCased = itemCode.replace(/[a-z]/g, (letter) => letter.toUpperCase())

  let n = 0
  for (const character of upperCased) {
    const value = ITEM_CODE_CHARACTERS.indexOf(character)
    if (value < 0) {
      return refuse(
        'item-code-character',
        `Item Code "${itemCode}" contains ${JSON.stringify(character)}; ` +
          'only 0–9, A–Z, space, "-", "&" and "." are allowed.'
      )
    }
    n = n * ITEM_CODE_CHARACTERS.length + value
  }

  if (!isPackVolumeDigit(packVolumeDigit)) {
    return refuse('pack-volume-digit', `Pack Volume digit must be 0–5; got ${packVolumeDigit}.`)
  }

  const first13Digits = `${packVolumeDigit}${INTERNAL_GTIN_PREFIX}${String(n).padStart(10, '0')}`
  return {
    ok: true,
    internalGtin: first13Digits + String(gs1CheckDigit(first13Digits)),
    itemCode: upperCased,
    packVolumeDigit
  }

  function refuse(reason: EncodeRefusal, message: string): EncodeInternalGtinResult {
    return { ok: false, reason, message }
  }
}

export type DecodeRefusal = 'not-14-digits' | 'check-digit' | 'prefix' | 'pack-volume-digit' | 'reserved-range'

export type DecodeInternalGtinResult =
  | { ok: true; itemCode: string; packVolumeDigit: PackVolumeDigit; packVolumeMl: PackVolumeMl | null }
  | { ok: false; reason: DecodeRefusal; message: string }

/**
 * Decodes a 14-digit GTIN back to Item Code and Pack Volume, refusing anything that is not a v1
 * Internal GTIN. Whether the Item Code exists in the Item List is the caller's question.
 */
export function decodeInternalGtin(gtin: string): DecodeInternalGtinResult {
  if (!/^[0-9]{14}$/.test(gtin)) {
    return refuse('not-14-digits', 'A GTIN must be exactly 14 digits.')
  }
  const expectedCheckDigit = gs1CheckDigit(gtin.slice(0, 13))
  if (Number(gtin[13]) !== expectedCheckDigit) {
    return refuse('check-digit', `Check digit is ${gtin[13]}, but should be ${expectedCheckDigit}.`)
  }
  if (gtin.slice(1, 3) !== INTERNAL_GTIN_PREFIX) {
    return refuse('prefix', `Not an Internal GTIN: digits 2–3 are "${gtin.slice(1, 3)}", not "04".`)
  }
  const packVolumeDigit = Number(gtin[0])
  if (!isPackVolumeDigit(packVolumeDigit)) {
    return refuse(
      'pack-volume-digit',
      packVolumeDigit === 9
        ? 'Not an Internal GTIN: digit 1 is 9 (GS1 variable measure).'
        : `Not a v1 Internal GTIN: Pack Volume digit ${packVolumeDigit} is reserved for a future version.`
    )
  }
  let n = Number(gtin.slice(3, 13))
  if (n >= FIRST_RESERVED_ITEM_NUMBER) {
    return refuse('reserved-range', 'Not a v1 Internal GTIN: its Item Code number is in the reserved range.')
  }

  let itemCode = ''
  for (let i = 0; i < ITEM_CODE_LENGTH; i++) {
    itemCode = ITEM_CODE_CHARACTERS[n % ITEM_CODE_CHARACTERS.length] + itemCode
    n = Math.floor(n / ITEM_CODE_CHARACTERS.length)
  }
  return { ok: true, itemCode, packVolumeDigit, packVolumeMl: packVolumeMlForDigit(packVolumeDigit) }

  function refuse(reason: DecodeRefusal, message: string): DecodeInternalGtinResult {
    return { ok: false, reason, message }
  }
}
