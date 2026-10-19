/**
 * The Pending Labels in the data folder: `pending.dat`, sealed, shared by every PC. Every change
 * (save, delete, claim for printing) reads the file, changes it and writes it back while holding the
 * lock file `pending.lock`, so two PCs never overwrite each other's change. The lock is created
 * exclusively; a lock older than `STALE_LOCK_MS` was left by a PC that stopped mid-change and is
 * taken over. A damaged or changed `pending.dat` is refused, never replaced.
 */
import { randomUUID } from 'node:crypto'
import { open, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_PENDING_LABELS, type PendingLabel } from '../core/pendingLabel'
import { errorCode, errorText } from './atomicWrite'
import { readSealed, writeSealed } from './sealed'

export const PENDING_FILE_NAME = 'pending.dat'
export const PENDING_LOCK_NAME = 'pending.lock'

/** A change takes milliseconds, so a lock this old was left behind. */
export const STALE_LOCK_MS = 30_000
/** Waits before each try to take the lock, in ms; about 10 s in all. */
export const LOCK_RETRY_DELAYS_MS: readonly number[] = [25, 50, 100, 200, 400, 400, 800, 800, 800, 800, 1000, 1000, 1000, 1000, 1000, 1000]

export function pendingPath(dataFolder: string): string {
  return join(dataFolder, PENDING_FILE_NAME)
}

export function pendingLockPath(dataFolder: string): string {
  return join(dataFolder, PENDING_LOCK_NAME)
}

/** What the Pending Label store uses from outside, replaceable in tests. */
export interface PendingStoreDeps {
  now(): Date
  sleep(ms: number): Promise<void>
}

export const defaultPendingDeps: PendingStoreDeps = { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }

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
  const lock = await takeLock(dataFolder, deps)
  if (!lock.ok) return lock
  try {
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
  } finally {
    await unlink(pendingLockPath(dataFolder)).catch(() => undefined)
  }
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
      const saved: PendingLabel = { ...label, id: randomUUID(), savedAt: deps.now().toISOString() }
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

/** Creates the lock file, waiting for another PC's lock to go and taking over a stale one. */
async function takeLock(dataFolder: string, deps: PendingStoreDeps): Promise<{ ok: true } | { ok: false; message: string }> {
  const path = pendingLockPath(dataFolder)
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(path, 'wx')
      await handle.close()
      return { ok: true }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        return { ok: false, message: `The Pending Labels could not be locked: ${errorText(error)}` }
      }
    }
    if (await breakStaleLock(path, deps.now())) continue
    if (attempt >= LOCK_RETRY_DELAYS_MS.length) {
      return { ok: false, message: 'The Pending Labels are being changed on another PC. Try again in a moment.' }
    }
    await deps.sleep(LOCK_RETRY_DELAYS_MS[attempt])
  }
}

/**
 * Removes the lock if it is stale. It is renamed away first and only then deleted, so a PC that
 * judged the same lock stale a moment later finds it gone instead of deleting a new lock.
 */
async function breakStaleLock(path: string, now: Date): Promise<boolean> {
  try {
    const stats = await stat(path)
    if (now.getTime() - stats.mtimeMs < STALE_LOCK_MS) return false
    const aside = `${path}.stale-${randomUUID()}`
    await rename(path, aside)
    await unlink(aside).catch(() => undefined)
    return true
  } catch (error) {
    // Gone already (released or broken by another PC): try to take it again.
    return errorCode(error) === 'ENOENT'
  }
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
