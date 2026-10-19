/**
 * The Lot picker: an item's Lots from today's Stock Onhand, earliest Expiry first, each judged by the
 * same Lot and Expiry rules as a typed entry. Picking one fills Lot and Expiry exactly as recorded.
 *
 * Pure: no Node, DOM or Electron, never reads the clock. Callers pass today's local date as `yyyy-mm-dd`.
 */

import { checkExpiry, formatExpiry, parseGs1Expiry, type CalendarDate } from './expiry'
import { normaliseLot } from './lot'
import { staleStockOnhandMessage, stockOnhandValidity, type StockLot, type StockOnhandInfo } from './stockOnhand'

/** One Lot offered by the picker. */
export interface LotChoice {
  /** As recorded in the Stock Onhand. */
  readonly lot: string
  /** e.g. `25 MAY 2027`; null when the Stock Onhand has no Expiry for the Lot. */
  readonly expiryText: string | null
  /** e.g. `1,500 TAB`. */
  readonly quantityText: string
  /**
   * `ok`; `warning`: short expiry, can be picked; `blocked`: the Expiry has passed; `invalid`: the Lot
   * rules refuse the Lot, or it has no Expiry. Only `ok` and `warning` can be picked.
   */
  readonly status: 'ok' | 'warning' | 'blocked' | 'invalid'
  /** Why it is blocked, invalid or warned about. */
  readonly message: string | null
  /** The form values picking fills in (Lot, and Expiry as the 8-digit `ddmmyyyy` entry); null if it cannot be picked. */
  readonly fill: { readonly lot: string; readonly expiry: string } | null
}

/** What the picker shows for an Item Code found in the Item List. */
export type LotPicker =
  | { readonly status: 'none'; readonly message: string }
  | { readonly status: 'stale'; readonly message: string }
  | { readonly status: 'no-lots'; readonly message: string }
  | { readonly status: 'choices'; readonly choices: readonly LotChoice[] }

/**
 * The picker for `itemCode`, given the Stock Onhand in use (`stock`, null if none) and the item's
 * Lots in it: its Lots only if the Stock Onhand is dated today, otherwise why there are none.
 */
export function lotPicker(stock: StockOnhandInfo | null, itemCode: string, lots: readonly StockLot[], today: string): LotPicker {
  switch (stockOnhandValidity(stock, today)) {
    case 'none':
      return { status: 'none', message: 'No Stock Onhand for today: type the Lot and Expiry.' }
    case 'stale':
      return { status: 'stale', message: staleStockOnhandMessage(stock!) }
    case 'today':
      return lots.length === 0
        ? { status: 'no-lots', message: `${itemCode} has no Lots in today’s Stock Onhand: type the Lot and Expiry.` }
        : { status: 'choices', choices: lotChoices(lots, today) }
  }
}

/** The Lots as choices, earliest Expiry first (Lots without one last), then by Lot. */
export function lotChoices(lots: readonly StockLot[], today: string): LotChoice[] {
  return [...lots].sort(compareLots).map((lot) => lotChoice(lot, today))
}

function lotChoice(stockLot: StockLot, today: string): LotChoice {
  const expiry = stockLot.expiry === null ? null : parseGs1Expiry(stockLot.expiry)
  const base = {
    lot: stockLot.lot,
    expiryText: expiry ? formatExpiry(expiry) : null,
    quantityText: stockLot.uom ? `${formatQuantity(stockLot.quantity)} ${stockLot.uom}` : formatQuantity(stockLot.quantity)
  }
  const cannotPick = (status: 'blocked' | 'invalid', message: string): LotChoice => ({ ...base, status, message, fill: null })

  const lot = normaliseLot(stockLot.lot)
  if (!lot.ok) return cannotPick('invalid', lot.message)
  if (!expiry) return cannotPick('invalid', 'The Stock Onhand has no Expiry for this Lot.')
  const checked = checkExpiry(expiry, today)
  if (!checked.ok) return cannotPick('blocked', checked.message)
  const fill = { lot: lot.lot, expiry: expiryEntry(expiry) }
  return checked.warning ? { ...base, status: 'warning', message: checked.warning, fill } : { ...base, status: 'ok', message: null, fill }
}

function compareLots(a: StockLot, b: StockLot): number {
  if (a.expiry !== b.expiry) {
    if (a.expiry === null) return 1
    if (b.expiry === null) return -1
    return a.expiry < b.expiry ? -1 : 1
  }
  return a.lot < b.lot ? -1 : a.lot > b.lot ? 1 : 0
}

/** AI (17) `YYMMDD` → the Expiry field's 8-digit `ddmmyyyy` entry (20YY); null if not a real date. */
export function expiryEntryOf(yymmdd: string): string | null {
  const date = parseGs1Expiry(yymmdd)
  return date ? expiryEntry(date) : null
}

function expiryEntry(date: CalendarDate): string {
  return pad2(date.day) + pad2(date.month) + String(date.year)
}

/** `1500` → `1,500`; `12.5` → `12.5`: digits grouped with commas whatever the locale. */
export function formatQuantity(quantity: number): string {
  const [whole, fraction] = String(Math.abs(quantity)).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${quantity < 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
