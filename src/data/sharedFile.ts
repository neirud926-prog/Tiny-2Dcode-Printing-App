/**
 * A sealed data file shared by every PC (`items.dat`, `stock.dat`), kept in memory and reloaded when
 * another PC sharing the data folder replaces it: its size or modified time changes. A damaged or
 * changed file found later is ignored until the next start: the value in use was verified when read.
 */
import { stat } from 'node:fs/promises'

export interface SharedFile<T, R> {
  /** Reads the file (at startup): the value in use is what it holds, or none if it cannot be used. */
  load(): Promise<R>
  /** The value in use, first reloaded if another PC has replaced the file since; null if none. */
  current(): Promise<T | null>
  /** This PC has just written the file, holding `value`. */
  replaced(value: T): Promise<void>
}

/** `read` reads the file; `valueOf` is the value a read gave, or null if it cannot be used. */
export function createSharedFile<T, R>(path: string, read: () => Promise<R>, valueOf: (result: R) => T | null): SharedFile<T, R> {
  let inUse: T | null = null
  /** Size and modified time of the file `inUse` came from (or was last checked). */
  let seen: string | null = null

  async function stampOf(): Promise<string | null> {
    try {
      const stats = await stat(path)
      return `${stats.size}:${stats.mtimeMs}`
    } catch {
      return null
    }
  }

  /** Reads the file; a value that cannot be used replaces the one in use only if `strict`. */
  async function reload(strict: boolean): Promise<R> {
    const stamp = await stampOf()
    const result = await read()
    seen = stamp
    const value = valueOf(result)
    if (value !== null) inUse = value
    else if (strict) inUse = null
    return result
  }

  return {
    load: () => reload(true),
    async current() {
      const stamp = await stampOf()
      if (stamp !== null && stamp !== seen) await reload(false)
      return inUse
    },
    async replaced(value) {
      inUse = value
      seen = await stampOf()
    }
  }
}
