import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ITEM_CODE_CHARACTERS, decodeInternalGtin, encodeInternalGtin, packVolumeMlForDigit } from './internalGtin'
import type { PackVolumeDigit } from './internalGtin'

// The shared test-case file BCS and RxStation copy (regenerate with `npm run test-vectors`).
const TEST_CASE_FILE = join(__dirname, '..', '..', 'test-vectors', 'internal-gtin-v1.csv')

interface TestCase {
  line: number
  itemCode: string
  packVolumeDigit: PackVolumeDigit
  internalGtin: string
}

function readTestCases(): TestCase[] {
  const [header, ...rows] = readFileSync(TEST_CASE_FILE, 'utf8').split(/\r?\n/)
  expect(header).toBe('item_code,pack_volume_digit,internal_gtin')
  return rows
    .map((row, index) => ({ row, line: index + 2 }))
    .filter(({ row }) => row !== '')
    .map(({ row, line }) => {
      const match = /^"([^"]*)",([0-9]),([0-9]{14})$/.exec(row)
      if (!match) throw new Error(`Line ${line} is not "item_code",digit,gtin: ${JSON.stringify(row)}`)
      return { line, itemCode: match[1], packVolumeDigit: Number(match[2]) as PackVolumeDigit, internalGtin: match[3] }
    })
}

const testCases = readTestCases()

describe('shared test-case file test-vectors/internal-gtin-v1.csv', () => {
  it('every row encodes to its Internal GTIN and decodes back to itself', () => {
    const failures: string[] = []
    for (const { line, itemCode, packVolumeDigit, internalGtin } of testCases) {
      const encoded = encodeInternalGtin(itemCode, packVolumeDigit)
      if (!encoded.ok || encoded.internalGtin !== internalGtin || encoded.itemCode !== itemCode) {
        const input = `${JSON.stringify(itemCode)}/${packVolumeDigit}`
        failures.push(`line ${line}: encode ${input} → ${JSON.stringify(encoded)}`)
      }
      const decoded = decodeInternalGtin(internalGtin)
      const expected = { ok: true, itemCode, packVolumeDigit, packVolumeMl: packVolumeMlForDigit(packVolumeDigit) }
      if (JSON.stringify(decoded) !== JSON.stringify(expected)) {
        failures.push(`line ${line}: decode ${internalGtin} → ${JSON.stringify(decoded)}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('starts with the ADR-0002 worked examples', () => {
    const firstRows = testCases.slice(0, 4).map((row) => [row.itemCode, row.packVolumeDigit, row.internalGtin])
    expect(firstRows).toEqual([
      ['PARA01', 0, '00425873440010'],
      ['PARA18', 0, '00425873440485'],
      ['PARA18', 2, '20425873440489'],
      ['AIR 01', 0, '00410718656015']
    ])
  })

  it('covers all 40 characters in every position, every Pack Volume digit and both boundaries', () => {
    for (let position = 0; position < 6; position++) {
      const seen = new Set(testCases.map(({ itemCode }) => itemCode[position]))
      const missing = [...ITEM_CODE_CHARACTERS].filter((character) => !seen.has(character))
      expect(missing, `characters missing at position ${position + 1}`).toEqual([])
    }
    expect(new Set(testCases.map(({ packVolumeDigit }) => packVolumeDigit))).toEqual(new Set([0, 1, 2, 3, 4, 5]))
    const itemCodes = new Set(testCases.map(({ itemCode }) => itemCode))
    expect(itemCodes).toContain('000000')
    expect(itemCodes).toContain('......')
  })

  it('covers every observed Item Code pattern', () => {
    const shapes = new Set(testCases.map(({ itemCode }) => itemCode.replace(/[A-Z]/g, 'A').replace(/[0-9]/g, '9')))
    for (const shape of ['AAAA99', 'AAAAA9', 'A99999', 'AAAAAA', 'AAAA9A', 'AAA 99', 'AA-999', 'A&A A9', 'AAA.99']) {
      expect(shapes, shape).toContain(shape)
    }
  })
})
