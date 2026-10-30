import { lookupItem, MAX_ECHOED_ITEM_CODE_LENGTH, upperCaseAscii } from '../core/itemList'
import { stockLotsFor } from '../core/stockOnhand'
import type { LoadedItemList } from '../data/itemListStore'
import type { LoadedStockOnhand } from '../data/stockOnhandStore'
import type { ItemLookup, StockLotsLookup } from '../preload/api'

/** Answers the renderer's Item Code lookup from the Item List in use (`list`, null if none). */
export function itemLookupFor(list: LoadedItemList | null, input: unknown): ItemLookup {
  const itemList = list?.info ?? null
  if (typeof input !== 'string') return { status: 'unknown', itemCode: '', itemList }
  const item = list ? lookupItem(list.index, input) : null
  if (list && item) return { status: 'found', item, itemList: list.info }
  return { status: 'unknown', itemCode: upperCaseAscii(input.slice(0, MAX_ECHOED_ITEM_CODE_LENGTH)), itemList }
}

/**
 * Answers the renderer's request for an item's Lots from the Stock Onhand in use (`stock`, null if
 * none), whatever its Report Date: the renderer applies the Report Date rule with today's date.
 */
export function stockLotsLookupFor(stock: LoadedStockOnhand | null, input: unknown): StockLotsLookup {
  const stockOnhand = stock?.info ?? null
  if (stock === null || typeof input !== 'string') return { stockOnhand, lots: [] }
  return { stockOnhand, lots: stockLotsFor(stock.index, input) }
}
