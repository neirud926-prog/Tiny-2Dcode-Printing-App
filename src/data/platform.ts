/**
 * The file system and paths the data layer uses, supplied by the host: Node in the Electron main
 * process and in tests (`nodePlatform.ts`), Rust commands in the Tauri app. Nothing here imports
 * Node, so the same data layer runs in a webview too. Failures are Errors with a Node-style `code`
 * (`ENOENT`, `EEXIST`, `EBUSY`, `EPERM`, `EACCES`, …), which the data layer checks.
 */

export interface FileStats {
  readonly size: number
  /** Last-modified time, ms since 1970, as the file system (for a share: the file server) set it. */
  readonly mtimeMs: number
}

export interface PlatformFs {
  readFile(path: string): Promise<Uint8Array>
  /** Creates `path`, failing with EEXIST if it exists, writes `data` and flushes it to disk. */
  createFile(path: string, data: Uint8Array): Promise<void>
  /** Appends to `path`, creating it if missing. */
  appendFile(path: string, data: Uint8Array): Promise<void>
  /** Renames `from` to `to`, replacing `to` if it exists. */
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  /** Creates the folder and any missing parents; an existing folder is fine. */
  mkdir(path: string): Promise<void>
  stat(path: string): Promise<FileStats>
}

export interface PlatformPath {
  join(...parts: string[]): string
  dirname(path: string): string
  basename(path: string): string
}

export interface Platform {
  readonly fs: PlatformFs
  readonly path: PlatformPath
}

/** `bytes` random bytes as hex (Web Crypto, in Node and in webviews alike). */
export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

let current: Platform | null = null

/** Sets the platform, once at startup, before the data layer is used. */
export function setPlatform(platform: Platform): void {
  current = platform
}

export function platform(): Platform {
  if (!current) throw new Error('The platform has not been set (setPlatform at startup).')
  return current
}
