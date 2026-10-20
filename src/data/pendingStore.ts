/**
 * The Pending Labels in the data folder: `pending.dat`, sealed, shared by every PC. Every change
 * (save, delete, claim for printing) is made holding the lock file `pending.lock` (see `fileLock`),
 * so two PCs never overwrite each other's change. A damaged or changed `pending.dat` is refused,
 * never replaced.
 */
import { MAX_PENDING_LABELS, type PendingLabel } from '../core/pendingLabel'
import { errorText } from './atomicWrite'
import { defaultLockDeps, withFileLock, type LockDeps } from './fileLock'
import { platform } from './platform'
import { readSealed, writeSealed } from './sealed'

export const PENDING_FILE_NAME = 'pending.dat'
export const PENDING_LOCK_NAME = 'pending.lock'

export { LOCK_RETRY_DELAYS_MS, STALE_LOCK_MS } from './fileLock'

export function pendingPath(dataFolder: string): string {
  return platform().path.join(dataFolder, PENDING_FILE_NAME)
}

export function pendingLockPath(dataFolder: string): string {
  return platform().path.join(dataFolder, PENDING_LOCK_NAME)
}

/** What the Pending Label store uses from outside, replaceable in tests. */
export type PendingStoreDeps = LockDeps

export const defaultPendingDeps: PendingStoreDeps = defaultLockDeps

export type PendingReadResult = { ok: true; labels: PendingLabel[] } | { ok: false; message: string }

/** Reads `pending.dat`: its Pending Labels (none if there is no file), or why it cannot be used. */
export async function readPending(dataFolder: string): Promise<PendingReadResult> {
  const read = await readSealed(pendingPath(dataFolder))
  switch (read.status) {
    case 'missing':
      return { ok: true, labels: [] }
    case 'tampered':
      return { ok: false, message: `The Pending Labels (${PENDING_FILE_NAME}) were changed outside the app.` }
    case 'unreadable':
      return { ok: false, message: `The Pending Labels could not be used: ${read.message}` }
    case 'ok': {
      const labels = asPendingLabels(read.value)
      return labels ? { ok: true, labels } : { ok: false, message: `The Pending Labels (${PENDING_FILE_NAME}) are not a valid list.` }
    }
  }
}

export type PendingChange<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * Applies `change` to the Pending Labels under the lock and writes the result. `change` returns the
 * new list and a value for the caller, or refuses (nothing is written).
 */
export async function changePending<T>(
  dataFolder: string,
  change: (labels: readonly PendingLabel[]) => { ok: true; labels: readonly PendingLabel[]; value: T } | { ok: false; message: string },
  deps: PendingStoreDeps = defaultPendingDeps
): Promise<PendingChange<T>> {
  return withFileLock(pendingLockPath(dataFolder), 'The Pending Labels', deps, async () => {
    const current = await readPending(dataFolder)
    if (!current.ok) return current
    const changed = change(current.labels)
    if (!changed.ok) return changed
    try {
      await writeSealed(pendingPath(dataFolder), changed.labels)
    } catch (error) {
      return { ok: false, message: `The Pending Labels could not be saved: ${errorText(error)}` }
    }
    return { ok: true, value: changed.value }
  })
}

/** Adds a Pending Label. */
export function addPending(
  dataFolder: string,
  label: Omit<PendingLabel, 'id' | 'savedAt'>,
  deps: PendingStoreDeps = defaultPendingDeps
): Promise<PendingChange<PendingLabel>> {
  return changePending(
    dataFolder,
    (labels) => {
      if (labels.length >= MAX_PENDING_LABELS) {
        return { ok: false, message: `There are already ${MAX_PENDING_LABELS} Pending Labels. Print or delete some first.` }
      }
      const saved: PendingLabel = { ...label, id: crypto.randomUUID(), savedAt: deps.now().toISOString() }
      return { ok: true, labels: [...labels, saved], value: saved }
    },
    deps
  )
}

/** Removes a Pending Label and returns it, so whoever removed it alone may print it. */
export function removePending(dataFolder: string, id: string, deps: PendingStoreDeps = defaultPendingDeps): Promise<PendingChange<PendingLabel>> {
  return changePending(
    dataFolder,
    (labels) => {
      const found = labels.find((label) => label.id === id)
      if (!found) return { ok: false, message: 'That Pending Label is no longer there; another PC may have printed or deleted it.' }
      return { ok: true, labels: labels.filter((label) => label !== found), value: found }
    },
    deps
  )
}

/** Puts a removed Pending Label back (a print that failed), unless it is already there. */
export function restorePending(dataFolder: string, label: PendingLabel, deps: PendingStoreDeps = defaultPendingDeps): Promise<PendingChange<null>> {
  return changePending(
    dataFolder,
    (labels) => (labels.some((existing) => existing.id === label.id) ? { ok: true, labels, value: null } : { ok: true, labels: [...labels, label], value: null }),
    deps
  )
}

function asPendingLabels(value: unknown): PendingLabel[] | null {
  if (!Array.isArray(value)) return null
  const valid = value.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false
    const record = entry as Record<string, unknown>
    const strings = ['id', 'itemCode', 'expiry', 'lot', 'savedBy', 'pc', 'savedAt'] as const
    return (
      strings.every((key) => typeof record[key] === 'string') &&
      (record.packVolumeDigit === null || typeof record.packVolumeDigit === 'number') &&
      typeof record.copies === 'number'
    )
  })
  return valid ? (value as PendingLabel[]) : null
}
