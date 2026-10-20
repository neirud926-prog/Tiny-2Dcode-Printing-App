/**
 * The platform in the Tauri app: file operations are Rust commands (`src-tauri/src/main.rs`), which
 * refuse paths outside the data folder, the log folder and dialog-chosen files with EACCES. Paths
 * are Windows paths (`\`, and `/` accepted).
 */
import { invoke } from '@tauri-apps/api/core'
import type { Platform } from '../data/platform'

/** How a Rust file command fails. */
interface FsError {
  readonly code: string
  readonly message: string
}

/** Runs a file command; a failure becomes an Error with the Node-style `code` the data layer checks. */
async function fsCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    const { code, message } = typeof error === 'object' && error !== null ? (error as FsError) : { code: '', message: String(error) }
    throw Object.assign(new Error(message), { code })
  }
}

export function join(...parts: string[]): string {
  const joined = parts.filter((part) => part !== '').join('\\')
  if (joined === '') return '.'
  // Keep the `\\` of a UNC path (\\server\share), collapse every other run of separators.
  const unc = /^[\\/]{2}[^\\/]/.test(joined)
  return (unc ? '\\' : '') + joined.replace(/[\\/]+/g, '\\')
}

export function dirname(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (cut < 0) return '.'
  const head = path.slice(0, cut)
  // The folder of `C:\x` is `C:\`, of `\x` is `\`.
  return head === '' || /^[A-Za-z]:$/.test(head) ? path.slice(0, cut + 1) : head
}

export function basename(path: string): string {
  return path.split(/[\\/]+/).filter((part) => part !== '').pop() ?? ''
}

export const tauriPlatform: Platform = {
  fs: {
    readFile: async (path) => new Uint8Array(await fsCommand<ArrayBuffer>('read_file', { path })),
    createFile: (path, data) => fsCommand('create_file', { path, data: Array.from(data) }),
    appendFile: (path, data) => fsCommand('append_file', { path, data: Array.from(data) }),
    rename: (from, to) => fsCommand('rename', { from, to }),
    unlink: (path) => fsCommand('unlink', { path }),
    mkdir: (path) => fsCommand('mkdir_all', { path }),
    stat: (path) => fsCommand('stat', { path })
  },
  path: { join, dirname, basename }
}
