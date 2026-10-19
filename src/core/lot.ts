/**
 * Lot rules: `A–Z 0–9 - / ( )`, lower case a–z upper-cased, 1–20 characters. GS1 AI (10) allows
 * more, but this narrower set reads the same on every scanner. A space is refused with its own
 * message because GS1 cannot encode one.
 *
 * Pure: no Electron, no file access.
 */

export const LOT_MAX_LENGTH = 20

export const LOT_PATTERN = /^[A-Z0-9\-/()]+$/

export type NormaliseLotResult = { ok: true; lot: string } | { ok: false; message: string }

/** Trims, upper-cases a–z and checks a Lot as entered; returns the Lot to print. */
export function normaliseLot(input: string): NormaliseLotResult {
  // Upper-case ASCII a–z only: String.prototype.toUpperCase would turn e.g. "ı" into "I".
  const lot = input.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase())

  if (lot === '') return refuse('Enter a Lot.')
  if (lot.includes(' ')) return refuse('GS1 cannot encode a space in a Lot.')
  const badCharacter = [...lot].find((character) => !LOT_PATTERN.test(character))
  if (badCharacter !== undefined) {
    return refuse(
      `A Lot cannot contain ${JSON.stringify(badCharacter)}; only A–Z, 0–9, "-", "/", "(" and ")" are allowed.`
    )
  }
  if (lot.length > LOT_MAX_LENGTH) {
    return refuse(`A Lot can have at most ${LOT_MAX_LENGTH} characters; this one has ${lot.length}.`)
  }
  return { ok: true, lot }

  function refuse(message: string): NormaliseLotResult {
    return { ok: false, message }
  }
}

/** True if `lot` is already a valid Lot exactly as it will be printed (no trimming or upper-casing needed). */
export function isPrintableLot(lot: string): boolean {
  const result = normaliseLot(lot)
  return result.ok && result.lot === lot
}
