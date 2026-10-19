/**
 * Pending Labels: label requests whose Item Code was not yet in the Item List, kept in the shared
 * `pending.dat` until a newer Item List lists the code. Pure: no Electron, no file access.
 */

import { isLiquid, lookupItem, type ItemIndex } from './itemList'
import type { LabelRequest } from './label'

/** The most Pending Labels kept; a longer list is a sign the Item List is not being kept up to date. */
export const MAX_PENDING_LABELS = 200

/** A saved request. The Pack Volume is null when staff could not choose one (the code was unknown). */
export interface PendingLabel {
  readonly id: string
  readonly itemCode: string
  /** Pack Volume digit per ADR-0002; null until chosen (a liquid needs one to print). */
  readonly packVolumeDigit: number | null
  /** 8 digits `ddmmyyyy`. */
  readonly expiry: string
  readonly lot: string
  readonly copies: number
  /** The Windows user who saved it. */
  readonly savedBy: string
  /** The PC it was saved on. */
  readonly pc: string
  /** ISO 8601. */
  readonly savedAt: string
}

/** What staff send to save: the request, with the Pack Volume only if known. */
export interface PendingLabelInput {
  readonly itemCode: string
  readonly packVolumeDigit: number | null
  readonly expiry: string
  readonly lot: string
  readonly copies: number
}

/** A Pending Label with what the Item List in use says about it now. */
export type PendingLabelView = PendingLabel & (
  | { readonly status: 'waiting' }
  | { readonly status: 'ready'; readonly itemName: string; readonly liquid: boolean }
)

/** The Item List's say on each Pending Label: `ready` once its Item Code is listed. */
export function viewPendingLabels(labels: readonly PendingLabel[], index: ItemIndex | null): PendingLabelView[] {
  return labels.map((label) => {
    const item = index ? lookupItem(index, label.itemCode) : null
    return item ? { ...label, status: 'ready', itemName: item.name, liquid: isLiquid(item) } : { ...label, status: 'waiting' }
  })
}

/**
 * What a check of the Pending Labels finds: the ids ready now, and whether any became ready since
 * the previous check (`previousReady`, null on the first check, which announces nothing).
 */
export function readyAnnouncement(previousReady: ReadonlySet<string> | null, labels: readonly PendingLabelView[]): { announce: boolean; ready: ReadonlySet<string> } {
  const ready = new Set(labels.filter((label) => label.status === 'ready').map((label) => label.id))
  return { announce: previousReady !== null && [...ready].some((id) => !previousReady.has(id)), ready }
}

/** The numbers on the Pending Labels button. */
export function pendingCounts(labels: readonly PendingLabelView[]): { ready: number; total: number } {
  return { ready: labels.filter((label) => label.status === 'ready').length, total: labels.length }
}

/** The label request for a Pending Label; a non-liquid has no Pack Volume, so null counts as 0 (none). */
export function pendingLabelRequest(label: Pick<PendingLabel, 'itemCode' | 'packVolumeDigit' | 'expiry' | 'lot' | 'copies'>): LabelRequest {
  return { itemCode: label.itemCode, packVolumeDigit: label.packVolumeDigit ?? 0, expiry: label.expiry, lot: label.lot, copies: label.copies }
}
