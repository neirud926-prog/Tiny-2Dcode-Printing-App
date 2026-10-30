import { lookupTopup, topupContent } from '../core/topup'
import type { LoadedTopupDatabase } from '../data/topupStore'
import type { TopupLookup } from '../preload/api'

/** Longer input from the renderer is cut to this length in the reply (an Item Code has 6 characters). */
const MAX_ECHOED_LENGTH = 32

/** Answers the renderer's Item Code lookup from the Topup Database in use, with the code content. */
export function topupLookupFor(database: LoadedTopupDatabase, input: unknown): TopupLookup {
  const topupDatabase = database.info
  const entry = typeof input === 'string' ? lookupTopup(database.index, input) : null
  if (entry) return { status: 'found', entry, content: topupContent(entry), topupDatabase }
  const itemCode = typeof input === 'string' ? input.slice(0, MAX_ECHOED_LENGTH).replace(/[a-z]/g, (letter) => letter.toUpperCase()) : ''
  return { status: 'unknown', itemCode, message: `${itemCode} is not in the Topup Database.`, topupDatabase }
}
