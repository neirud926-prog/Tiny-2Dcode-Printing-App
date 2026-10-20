/**
 * The lock file that guards a shared data file: every change reads the file, changes it and writes
 * it back while holding the lock, so two PCs never overwrite each other's change. The lock is created
 * exclusively; a lock older than `STALE_LOCK_MS` was left by a PC that stopped mid-change and is
 * taken over.
 */
import { errorCode, errorText } from './atomicWrite'
import { platform } from './platform'

/** A change takes milliseconds, so a lock this old was left behind. */
export const STALE_LOCK_MS = 30_000
/** Waits before each try to take the lock, in ms; about 10 s in all. */
export const LOCK_RETRY_DELAYS_MS: readonly number[] = [25, 50, 100, 200, 400, 400, 800, 800, 800, 800, 1000, 1000, 1000, 1000, 1000, 1000]

/** What a locked change uses from outside, replaceable in tests. */
export interface LockDeps {
  now(): Date
  sleep(ms: number): Promise<void>
}

export const defaultLockDeps: LockDeps = { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }

/**
 * Runs `task` holding the lock file at `path`. `what` names the shared data in messages, e.g.
 * "The Pending Labels".
 */
export async function withFileLock<T>(
  path: string,
  what: string,
  deps: LockDeps,
  task: () => Promise<T>
): Promise<T | { ok: false; message: string }> {
  const lock = await takeLock(path, what, deps)
  if (!lock.ok) return lock
  try {
    return await task()
  } finally {
    await platform().fs.unlink(path).catch(() => undefined)
  }
}

/** Creates the lock file, waiting for another PC's lock to go and taking over a stale one. */
async function takeLock(path: string, what: string, deps: LockDeps): Promise<{ ok: true } | { ok: false; message: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      await platform().fs.createFile(path, new Uint8Array())
      return { ok: true }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        return { ok: false, message: `${what} could not be locked: ${errorText(error)}` }
      }
    }
    if (await breakStaleLock(path)) continue
    if (attempt >= LOCK_RETRY_DELAYS_MS.length) {
      return { ok: false, message: `${what} are being changed on another PC. Try again in a moment.` }
    }
    await deps.sleep(LOCK_RETRY_DELAYS_MS[attempt])
  }
}

/**
 * Removes the lock if it is stale. Its age is judged by the file server's clock, not this PC's: "now"
 * is the saved time of a temporary file made in the data folder (a PC with a wrong clock must not
 * break a live lock). The lock is renamed away first and only then deleted, so a PC that judged the
 * same lock stale a moment later finds it gone instead of deleting a new lock. This narrows the
 * window for two PCs breaking one lock at once; it cannot close it, which is enough for a few PCs.
 */
async function breakStaleLock(path: string): Promise<boolean> {
  const { fs } = platform()
  const clock = `${path}.clock-${crypto.randomUUID()}`
  try {
    const lockStats = await fs.stat(path)
    await fs.createFile(clock, new Uint8Array())
    const serverNow = (await fs.stat(clock)).mtimeMs
    if (serverNow - lockStats.mtimeMs < STALE_LOCK_MS) return false
    // Another PC may have broken this lock and taken a new one meanwhile: only the lock judged stale goes.
    if ((await fs.stat(path)).mtimeMs !== lockStats.mtimeMs) return false
    const aside = `${path}.stale-${crypto.randomUUID()}`
    await fs.rename(path, aside)
    await fs.unlink(aside).catch(() => undefined)
    return true
  } catch (error) {
    // Gone already (released or broken by another PC): try to take it again.
    return errorCode(error) === 'ENOENT'
  } finally {
    await fs.unlink(clock).catch(() => undefined)
  }
}
