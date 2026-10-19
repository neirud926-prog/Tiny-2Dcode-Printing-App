import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { countOf, parseItemList } from './itemList'

/**
 * Optional local check of the Item List parser over a real `item_phq.txt`. Skipped unless
 * ITEM_LIST_PATH is set; the file itself is never committed.
 *
 *   ITEM_LIST_PATH=/path/to/item_phq.txt npm test
 *
 * The counts are checked against a plain independent reading of the file (unique column 0, column 14
 * = ML), so the test holds for whichever Item List HA last issued.
 */
const itemListPath = process.env['ITEM_LIST_PATH']

describe.skipIf(!itemListPath)('Item List parser over the real Item List (ITEM_LIST_PATH)', () => {
  it('imports every row, counting items and liquids as a plain reading does', () => {
    const text = readFileSync(itemListPath!, 'latin1')
    const result = parseItemList(text)
    if (!result.ok) throw new Error(result.message)

    const rows = text.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => line.split('\t'))
    const firstByCode = new Map<string, string[]>()
    for (const cells of rows) if (!firstByCode.has(cells[0])) firstByCode.set(cells[0], cells)
    const liquids = [...firstByCode.values()].filter((cells) => cells[14]?.trim().toUpperCase() === 'ML').length

    const { summary } = result
    console.info(
      `Item List: ${countOf(summary.rows, 'row')} → ${countOf(summary.items, 'item')}, ${countOf(summary.liquids, 'liquid')}; ` +
        `${countOf(summary.badRows, 'bad row')}, ${countOf(summary.duplicates, 'duplicate')}`
    )
    expect(result.badRows).toEqual([])
    expect(result.summary).toEqual({
      rows: rows.length,
      items: firstByCode.size,
      liquids,
      badRows: 0,
      duplicates: rows.length - firstByCode.size
    })
    expect(result.items.every((item) => item.name !== '' && item.baseUnit !== '')).toBe(true)
  })
})
