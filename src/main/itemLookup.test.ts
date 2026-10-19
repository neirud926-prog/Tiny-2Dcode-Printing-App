import { describe, expect, it } from 'vitest'
import { indexItems, type ItemListInfo } from '../core/itemList'
import { itemLookupFor } from './itemLookup'

const info: ItemListInfo = {
  sourceFileName: 'item_phq.txt',
  sourceModified: '2026-10-09T14:24:03.000Z',
  importedAt: '2026-10-19T01:15:00.000Z',
  importedBy: 'chantm',
  pc: 'PHARM-01',
  items: 2,
  liquids: 1
}
const list = {
  info,
  index: indexItems([
    { itemCode: 'PARA18', name: 'SYNTHETIC FICTAMOL ORAL SOLUTION', baseUnit: 'ML' },
    { itemCode: 'AIR 01', name: 'SYNTHETIC TEST GAS', baseUnit: 'CYN' }
  ])
}

describe('itemLookupFor', () => {
  it('finds a listed Item Code, upper-casing a–z', () => {
    expect(itemLookupFor(list, 'para18')).toEqual({
      status: 'found',
      item: { itemCode: 'PARA18', name: 'SYNTHETIC FICTAMOL ORAL SOLUTION', baseUnit: 'ML' },
      itemList: info
    })
    expect(itemLookupFor(list, 'air 01')).toMatchObject({ status: 'found', item: { itemCode: 'AIR 01' } })
  })

  it('reports an unknown Item Code with the Item List searched', () => {
    expect(itemLookupFor(list, 'para99')).toEqual({ status: 'unknown', itemCode: 'PARA99', itemList: info })
  })

  it('reports every Item Code as unknown before an Item List is imported', () => {
    expect(itemLookupFor(null, 'PARA18')).toEqual({ status: 'unknown', itemCode: 'PARA18', itemList: null })
  })

  it('treats anything but a short string from the renderer as unknown', () => {
    for (const input of [undefined, null, 42, { itemCode: 'PARA18' }, ['PARA18']]) {
      expect(itemLookupFor(list, input)).toEqual({ status: 'unknown', itemCode: '', itemList: info })
    }
    expect(itemLookupFor(list, 'P'.repeat(1000))).toEqual({ status: 'unknown', itemCode: 'P'.repeat(32), itemList: info })
  })
})
