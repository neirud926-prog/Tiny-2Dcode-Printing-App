/**
 * What happens to a Pending Label, without Electron: saving it (with the same checks as a label,
 * except that the Item Code need not be listed yet), listing it with what the Item List says now,
 * printing it (through the same checks, self-check and print log as any label) and deleting it.
 */

import { localIsoDate } from '../core/expiry'
import { isLiquid, lookupItem, type ItemIndex } from '../core/itemList'
import { buildLabel } from '../core/label'
import { pendingLabelRequest, viewPendingLabels, type PendingLabelInput } from '../core/pendingLabel'
import { addPending, defaultPendingDeps, readPending, removePending, restorePending } from '../data/pendingStore'
import type { DeletePendingOutcome, PendingLabelsList, PrintOutcome, SavePendingOutcome } from '../preload/api'
import type { PcSettings } from '../render/printSettings'
import { printLabelRequest, type PrintContext, type PrintServiceDeps } from './printService'

/** Lists the Pending Labels against the Item List in use (null if none): the recheck after every import. */
export async function listPendingLabels(dataFolder: string, itemList: ItemIndex | null): Promise<PendingLabelsList> {
  const read = await readPending(dataFolder)
  return read.ok ? { ok: true, labels: viewPendingLabels(read.labels, itemList) } : read
}

/** Saves a request as a Pending Label if the label core would accept it (its Item Code may be unlisted). */
export async function savePendingLabel(input: unknown, context: PrintContext, deps: Pick<PrintServiceDeps, 'now'>): Promise<SavePendingOutcome> {
  if (!isPendingInput(input)) return { ok: false, message: 'Not saved: the label request is not valid.' }
  const at = deps.now()
  const built = buildLabel({ ...pendingLabelRequest(input), packVolumeDigit: input.packVolumeDigit ?? 0 }, { today: localIsoDate(at) })
  if (!built.ok) return { ok: false, message: `Not saved: ${built.errors.map((error) => error.message).join(' ')}` }

  const { label } = built
  const saved = await addPending(
    context.dataFolder,
    {
      itemCode: label.itemCode,
      packVolumeDigit: input.packVolumeDigit,
      expiry: input.expiry,
      lot: label.lot,
      copies: label.copies,
      savedBy: context.windowsUser,
      pc: context.pcName
    },
    { ...defaultPendingDeps, now: () => at }
  )
  if (!saved.ok) return { ok: false, message: `Not saved: ${saved.message}` }
  return { ok: true, message: `Saved ${label.itemCode} as a Pending Label. It prints once an Item List with this Item Code is imported.` }
}

/**
 * Prints a Pending Label whose Item Code is now listed. The label is claimed first (removed from
 * `pending.dat`), so another PC cannot print it too; if it does not print, it is put back.
 */
export async function printPendingLabel(
  id: unknown,
  packVolumeDigit: unknown,
  settings: PcSettings | null,
  itemList: ItemIndex | null,
  context: PrintContext,
  deps: PrintServiceDeps
): Promise<PrintOutcome> {
  if (typeof id !== 'string') return refused('the request is not valid.')
  if (packVolumeDigit !== null && packVolumeDigit !== undefined && typeof packVolumeDigit !== 'number') return refused('the request is not valid.')
  if (settings === null) return refused("set up this PC's printer first.")
  if (itemList === null) return refused('import the Item List first.')

  const read = await readPending(context.dataFolder)
  if (!read.ok) return refused(read.message)
  const pending = read.labels.find((label) => label.id === id)
  if (!pending) return refused('that Pending Label is no longer there; another PC may have printed or deleted it.')
  const item = lookupItem(itemList, pending.itemCode)
  if (!item) return refused(`${pending.itemCode} is not in the Item List yet.`)

  const digit = pending.packVolumeDigit ?? packVolumeDigit ?? null
  if (digit === null && isLiquid(item)) return refused(`${pending.itemCode} is a liquid: choose its Pack Volume.`)

  const claimed = await removePending(context.dataFolder, id)
  if (!claimed.ok) return refused(claimed.message)

  const outcome = await printLabelRequest(pendingLabelRequest({ ...claimed.value, packVolumeDigit: digit }), settings, itemList, context, deps)
  if (outcome.ok) return outcome

  const restored = await restorePending(context.dataFolder, claimed.value)
  return restored.ok ? outcome : { ok: false, message: `${outcome.message} The Pending Label could not be put back: ${restored.message}` }
}

/** Deletes a Pending Label without printing it. */
export async function deletePendingLabel(dataFolder: string, id: unknown): Promise<DeletePendingOutcome> {
  if (typeof id !== 'string') return { ok: false, message: 'The request is not valid.' }
  const removed = await removePending(dataFolder, id)
  return removed.ok ? { ok: true } : { ok: false, message: removed.message }
}

function refused(message: string): PrintOutcome {
  return { ok: false, message: `Not printed: ${message}` }
}

function isPendingInput(value: unknown): value is PendingLabelInput {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.itemCode === 'string' &&
    (record.packVolumeDigit === null || typeof record.packVolumeDigit === 'number') &&
    typeof record.expiry === 'string' &&
    typeof record.lot === 'string' &&
    typeof record.copies === 'number'
  )
}
