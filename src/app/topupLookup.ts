import { MAX_ECHOED_ITEM_CODE_LENGTH, upperCaseAscii } from '../core/itemList'
import { lookupTopup, topupContent } from '../core/topup'
import type { LoadedTopupDatabase } from '../data/topupStore'
import type { TopupLookup } from '../preload/api'

/** Answers the renderer's Item Code lookup from the Topup Database in use, with the code content. */
export function topupLookupFor(database: LoadedTopupDatabase, input: unknown): TopupLookup {
  const topupDatabase = database.info
  const entry = typeof input === 'string' ? lookupTopup(database.index, input) : null
  if (entry) return { status: 'found', entry, content: topupContent(entry), topupDatabase }
  const itemCode = typeof input === 'string' ? upperCaseAscii(input.slice(0, MAX_ECHOED_ITEM_CODE_LENGTH)) : ''
  return { status: 'unknown', itemCode, message: `${itemCode} is not in the Topup Database.`, topupDatabase }
}
