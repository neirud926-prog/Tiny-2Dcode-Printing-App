/**
 * Atomic file replace for a shared drive: the data goes to a temp file beside the target, which is
 * then renamed over it. A reader on any PC sees the old file or the new one, never a half-written
 * one. Windows briefly locks a file that another PC is reading, so the rename is retried.
 */

import { randomBytes } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'

/** Waits before each rename retry, in ms; about 1.5 s in all. */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 800]

/** Errors Windows gives while another process holds the target open. */
const LOCK_ERRORS = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** The file operations used, replaceable in tests. */
export interface AtomicWriteDeps {
  /** Creates `path` (failing if it exists), writes `data` and flushes it to disk. */
  writeTempFile(path: string, data: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  sleep(ms: number): Promise<void>
}

export const defaultAtomicWriteDeps: AtomicWriteDeps = {
  async writeTempFile(path, data) {
    const handle = await open(path, 'wx')
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  rename,
  unlink,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

/** Replaces `target` with `data` atomically. The target's folder must exist. */
export async function writeFileAtomic(target: string, data: Uint8Array, deps: AtomicWriteDeps = defaultAtomicWriteDeps): Promise<void> {
  const temp = `${target}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  try {
    await deps.writeTempFile(temp, data)
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.rename(temp, target)
        return
      } catch (error) {
        if (!LOCK_ERRORS.has(errorCode(error)) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error
        await deps.sleep(RENAME_RETRY_DELAYS_MS[attempt])
      }
    }
  } catch (error) {
    await deps.unlink(temp).catch(() => undefined)
    throw new Error(`Could not save ${target}: ${errorText(error)}`, { cause: error })
  }
}

export function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : ''
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
