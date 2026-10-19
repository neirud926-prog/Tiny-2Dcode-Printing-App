/**
 * Generates test-vectors/internal-gtin-v1.csv, the shared Item Code → Internal GTIN test-case file
 * that BCS and RxStation copy to prove their encoders identical (ADR-0002).
 *
 *   npm run test-vectors
 *
 * Deliberately independent of src/core/internalGtin.ts: character values come from character-code
 * arithmetic, N from the ADR's positional formula in BigInt, and the check digit from GS1's
 * left-to-right "round up to a multiple of ten" rule. The ADR worked examples are checked first.
 *
 * Every Item Code here is synthetic (random or constructed); the repo is public, so no HA data.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_PATH = join(import.meta.dirname, '..', 'test-vectors', 'internal-gtin-v1.csv')
const SEED = 0x2d1abe1

// ---------------------------------------------------------------------------------------------
// Independent reference implementation of ADR-0002
// ---------------------------------------------------------------------------------------------

function characterValue(character: string): number {
  const code = character.length === 1 ? character.charCodeAt(0) : -1
  if (code >= 48 && code <= 57) return code - 48 // 0–9 → 0–9
  if (code >= 65 && code <= 90) return code - 55 // A–Z → 10–35
  switch (character) {
    case ' ':
      return 36
    case '-':
      return 37
    case '&':
      return 38
    case '.':
      return 39
    default:
      throw new Error(`Not an Item Code character: ${JSON.stringify(character)}`)
  }
}

function characterForValue(value: number): string {
  if (value < 10) return String.fromCharCode(48 + value)
  if (value < 36) return String.fromCharCode(55 + value)
  return [' ', '-', '&', '.'][value - 36]
}

/** N = v(c1)·40⁵ + v(c2)·40⁴ + v(c3)·40³ + v(c4)·40² + v(c5)·40 + v(c6) */
function itemCodeNumber(itemCode: string): bigint {
  if (itemCode.length !== 6) throw new Error(`Item Code must be 6 characters: ${JSON.stringify(itemCode)}`)
  let n = 0n
  for (const [index, character] of [...itemCode].entries()) {
    n += BigInt(characterValue(character)) * 40n ** BigInt(5 - index)
  }
  return n
}

/** GS1: weights 3,1,3,1,… from the left of the 13 digits; check digit tops the sum up to a multiple of 10. */
function checkDigit(first13Digits: string): number {
  if (!/^[0-9]{13}$/.test(first13Digits)) throw new Error(`Need 13 digits: ${first13Digits}`)
  let sum = 0
  for (let position = 1; position <= 13; position++) {
    sum += Number(first13Digits[position - 1]) * (position % 2 === 1 ? 3 : 1)
  }
  return Math.ceil(sum / 10) * 10 - sum
}

function referenceEncode(itemCode: string, packVolumeDigit: number): string {
  if (!Number.isInteger(packVolumeDigit) || packVolumeDigit < 0 || packVolumeDigit > 5) {
    throw new Error(`Pack Volume digit must be 0–5: ${packVolumeDigit}`)
  }
  const n = itemCodeNumber(itemCode)
  if (n >= 4_096_000_000n) throw new Error(`N out of range for ${itemCode}`)
  const first13Digits = `${packVolumeDigit}04${n.toString().padStart(10, '0')}`
  return first13Digits + checkDigit(first13Digits)
}

function referenceDecode(internalGtin: string): { itemCode: string; packVolumeDigit: number } {
  let n = BigInt(internalGtin.slice(3, 13))
  let itemCode = ''
  for (let i = 0; i < 6; i++) {
    itemCode = characterForValue(Number(n % 40n)) + itemCode
    n /= 40n
  }
  return { itemCode, packVolumeDigit: Number(internalGtin[0]) }
}

// ---------------------------------------------------------------------------------------------
// Self-check against hard-coded values before writing anything
// ---------------------------------------------------------------------------------------------

// ADR-0002 "Worked examples", verbatim: Item Code, Pack Volume digit, N, Internal GTIN.
const ADR_WORKED_EXAMPLES: readonly [string, number, bigint, string][] = [
  ['PARA01', 0, 2_587_344_001n, '00425873440010'],
  ['PARA18', 0, 2_587_344_048n, '00425873440485'],
  ['PARA18', 2, 2_587_344_048n, '20425873440489'],
  ['AIR 01', 0, 1_071_865_601n, '00410718656015']
]

function selfCheck(): void {
  const failures: string[] = []
  for (const [itemCode, packVolumeDigit, n, internalGtin] of ADR_WORKED_EXAMPLES) {
    if (itemCodeNumber(itemCode) !== n) failures.push(`${itemCode}: N ${itemCodeNumber(itemCode)} ≠ ${n}`)
    const encoded = referenceEncode(itemCode, packVolumeDigit)
    if (encoded !== internalGtin) failures.push(`${itemCode}/${packVolumeDigit}: ${encoded} ≠ ${internalGtin}`)
  }
  if (checkDigit('0400638133393') !== 1) failures.push('check digit of GTIN 4006381333931')
  if (itemCodeNumber('000000') !== 0n) failures.push('N of 000000')
  if (itemCodeNumber('......') !== 40n ** 6n - 1n) failures.push('N of ......')
  if (failures.length > 0) throw new Error(`Reference implementation self-check failed:\n${failures.join('\n')}`)
}

// ---------------------------------------------------------------------------------------------
// Synthetic Item Codes
// ---------------------------------------------------------------------------------------------

const ALL_CHARACTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ -&.'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

/** mulberry32: small seeded PRNG so the file regenerates byte-for-byte. */
function createRandom(seed: number): (below: number) => number {
  let state = seed >>> 0
  return (below) => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * below)
  }
}

/**
 * Item Code shapes: `A` = a letter, `9` = a digit, anything else is literal. These are the shapes
 * seen in the Item List (shapes only, no codes) plus the ticket's examples.
 */
const ITEM_CODE_SHAPES = [
  'AAAA99', 'AAAAA9', 'A99999', 'AAAAAA', 'AAAA9A', 'AAA A9', 'AAA 99', 'AAA 9A', 'AAA999', 'AA-999',
  'AAA AA', 'AAA-99', 'AA9999', '9AAA99', 'AA 999', 'A A 99', 'A9 A99', 'AA-A99', 'A-AA99', 'A999A9',
  '9-AA99', 'A-9 99', 'A-9999', 'A&A A9', 'A99 99', 'A AA99', 'A9A999', 'A-A-99', 'AA A99', 'AAA.99',
  'AA&A99', 'AAAA.9'
]
const CODES_PER_SHAPE = 20
const RANDOM_CODES = 300

function main(): void {
  selfCheck()
  const random = createRandom(SEED)
  const pick = (characters: string): string => characters[random(characters.length)]

  const rows: [string, number][] = []
  const seen = new Set<string>()
  const add = (itemCode: string, packVolumeDigit: number): void => {
    const key = `${itemCode}|${packVolumeDigit}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push([itemCode, packVolumeDigit])
  }
  const allPackVolumes = [0, 1, 2, 3, 4, 5]

  // 1. ADR-0002 worked examples, verbatim.
  for (const [itemCode, packVolumeDigit] of ADR_WORKED_EXAMPLES) add(itemCode, packVolumeDigit)

  // 2. Boundary values: smallest and largest N and their neighbours, with every Pack Volume digit.
  for (const itemCode of ['000000', '000001', '00000.', '.00000', '0.....', '.....-', '......']) {
    for (const packVolumeDigit of allPackVolumes) add(itemCode, packVolumeDigit)
  }

  // 3. All 40 characters in every position: among zeros with every Pack Volume digit, then among dots.
  for (let position = 0; position < 6; position++) {
    for (const [index, character] of [...ALL_CHARACTERS].entries()) {
      for (const packVolumeDigit of allPackVolumes) add(withCharacterAt('000000', position, character), packVolumeDigit)
      add(withCharacterAt('......', position, character), (index + position) % 6)
    }
  }

  // 4. Every Item Code shape, with random letters and digits.
  for (const shape of ITEM_CODE_SHAPES) {
    for (let i = 0; i < CODES_PER_SHAPE; i++) {
      const itemCode = [...shape].map((s) => (s === 'A' ? pick(LETTERS) : s === '9' ? pick(DIGITS) : s)).join('')
      add(itemCode, i % 6)
    }
  }

  // 5. Random codes over all 40 characters.
  for (let i = 0; i < RANDOM_CODES; i++) {
    add(Array.from({ length: 6 }, () => pick(ALL_CHARACTERS)).join(''), random(6))
  }

  const lines = ['item_code,pack_volume_digit,internal_gtin']
  for (const [itemCode, packVolumeDigit] of rows) {
    const internalGtin = referenceEncode(itemCode, packVolumeDigit)
    const decoded = referenceDecode(internalGtin)
    if (decoded.itemCode !== itemCode || decoded.packVolumeDigit !== packVolumeDigit) {
      throw new Error(`Reference round trip failed for ${JSON.stringify(itemCode)}/${packVolumeDigit}`)
    }
    // Item Codes are always quoted so leading and trailing spaces survive any CSV reader.
    lines.push(`"${itemCode}",${packVolumeDigit},${internalGtin}`)
  }
  writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n', 'utf8')
  console.log(`Wrote ${rows.length} rows to ${OUTPUT_PATH}`)
}

function withCharacterAt(itemCode: string, position: number, character: string): string {
  return itemCode.slice(0, position) + character + itemCode.slice(position + 1)
}

main()
