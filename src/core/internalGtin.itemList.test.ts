import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeInternalGtin, encodeInternalGtin, PACK_VOLUMES } from './internalGtin'

/**
 * Optional local check over a real Item List (`item_phq.txt`: tab-separated, latin1, Item Code in
 * column 0). Skipped unless ITEM_LIST_PATH is set; the file itself is never committed.
 *
 *   ITEM_LIST_PATH=/path/to/item_phq.txt npm test
 */
const itemListPath = process.env['ITEM_LIST_PATH']

describe.skipIf(!itemListPath)('Internal GTIN over the real Item List (ITEM_LIST_PATH)', () => {
  it('round-trips every valid Item Code with every Pack Volume digit', () => {
    const itemCodes = readFileSync(itemListPath!, 'latin1')
      .split(/\r?\n/)
      .filter((row) => row !== '')
      .map((row) => row.split('\t')[0])

    let valid = 0
    const failures: string[] = []
    for (const itemCode of itemCodes) {
      if (!encodeInternalGtin(itemCode, 0).ok) continue
      valid++
      for (const { digit } of PACK_VOLUMES) {
        const encoded = encodeInternalGtin(itemCode, digit)
        const decoded = encoded.ok ? decodeInternalGtin(encoded.internalGtin) : encoded
        if (!decoded.ok || decoded.itemCode !== itemCode.toUpperCase() || decoded.packVolumeDigit !== digit) {
          failures.push(`${JSON.stringify(itemCode)}/${digit}: ${JSON.stringify(decoded)}`)
        }
      }
    }
    console.info(`Item List: ${itemCodes.length} rows, ${valid} valid Item Codes, ${itemCodes.length - valid} refused`)
    expect(valid).toBeGreaterThan(0)
    expect(failures).toEqual([])
  })
})
