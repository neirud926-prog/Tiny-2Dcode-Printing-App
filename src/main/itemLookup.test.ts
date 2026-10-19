import { describe, expect, it } from 'vitest'
import { indexItems, type ItemListInfo } from '../core/itemList'
import { indexStockLots, type StockLot, type StockOnhandInfo } from '../core/stockOnhand'
import { itemLookupFor, stockLotsLookupFor } from './itemLookup'

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

describe('stockLotsLookupFor', () => {
  const stockInfo: StockOnhandInfo = {
    sourceFileName: 'stock_onhand.ps',
    sourceModified: '2026-10-19T08:25:10.000Z',
    importedAt: '2026-10-19T09:00:00.000Z',
    importedBy: 'chantm',
    pc: 'PHARM-01',
    reportDate: '2026-10-19',
    reportTime: '16:22:43',
    organizationCode: 'NL0',
    subinventoryCode: 'NL0-S-MAIN',
    items: 2,
    lots: 3
  }
  const lots: StockLot[] = [
    { itemCode: 'PARA18', lot: 'P18A001', expiry: '270601', uom: 'ML', quantity: 2400 },
    { itemCode: 'AIR 01', lot: 'G-7781', expiry: '280815', uom: 'CYN', quantity: 4 },
    { itemCode: 'PARA18', lot: 'P18B002', expiry: '270215', uom: 'ML', quantity: 1200 }
  ]
  const stock = { info: stockInfo, index: indexStockLots(lots) }

  it("answers with an item's Lots and the Stock Onhand they come from, upper-casing a–z", () => {
    expect(stockLotsLookupFor(stock, 'para18')).toEqual({ stockOnhand: stockInfo, lots: [lots[0], lots[2]] })
    expect(stockLotsLookupFor(stock, 'air 01')).toEqual({ stockOnhand: stockInfo, lots: [lots[1]] })
  })

  it('answers with no Lots for an item not in it, or before a Stock Onhand is imported', () => {
    expect(stockLotsLookupFor(stock, 'PARA01')).toEqual({ stockOnhand: stockInfo, lots: [] })
    expect(stockLotsLookupFor(null, 'PARA18')).toEqual({ stockOnhand: null, lots: [] })
  })

  it('answers anything but a string from the renderer with no Lots', () => {
    for (const input of [undefined, null, 42, { itemCode: 'PARA18' }, ['PARA18']]) {
      expect(stockLotsLookupFor(stock, input)).toEqual({ stockOnhand: stockInfo, lots: [] })
    }
  })
})
