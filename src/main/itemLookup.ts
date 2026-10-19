import { lookupItem } from '../core/itemList'
import type { LoadedItemList } from '../data/itemListStore'
import type { ItemLookup } from '../preload/api'

/** Longer input from the renderer is cut to this length in the reply (an Item Code has 6 characters). */
const MAX_ECHOED_LENGTH = 32

/** Answers the renderer's Item Code lookup from the Item List in use (`list`, null if none). */
export function itemLookupFor(list: LoadedItemList | null, input: unknown): ItemLookup {
  const itemList = list?.info ?? null
  if (typeof input !== 'string') return { status: 'unknown', itemCode: '', itemList }
  const item = list ? lookupItem(list.index, input) : null
  if (list && item) return { status: 'found', item, itemList: list.info }
  return { status: 'unknown', itemCode: input.slice(0, MAX_ECHOED_LENGTH).replace(/[a-z]/g, (letter) => letter.toUpperCase()), itemList }
}
