/**
 * Sealed data files: unreadable and uneditable by just opening them, and any outside change is
 * detected and refused.
 *
 *   "TDCP" | version (1 byte) | HMAC-SHA256(key, "TDCP" + version + payload) (32 bytes) | payload
 *   payload = gzip(JSON)
 *
 * The key is embedded in the app, so this stops casual edits and detects changes; it is not
 * encryption and is not tied to a PC or user. The MAC covers the header too, so every byte of the
 * file is checked. Writes are atomic (temp file, then rename), so other PCs never see half a file.
 */

import { errorCode, errorText, writeFileAtomic } from './atomicWrite'
import { platform } from './platform'

export const SEALED_MAGIC = new Uint8Array([0x54, 0x44, 0x43, 0x50]) // "TDCP"
export const SEALED_VERSION = 1

/** Fixed forever for version 1: changing it makes every existing data file read as changed. */
export const SEALED_FILE_KEY = hexBytes('77ab9371d9373823134124f6014cd11eddedb764373a9de39734c8434f99da3e')

const HEADER_LENGTH = SEALED_MAGIC.length + 1
const MAC_LENGTH = 32

export type ReadSealedResult =
  | { status: 'ok'; value: unknown }
  | { status: 'missing' }
  | { status: 'tampered'; message: string }
  | { status: 'unreadable'; message: string }

/** The sealed bytes for a JSON value. Throws if JSON cannot hold the value. */
export async function seal(value: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(value) as string | undefined
  if (json === undefined) throw new Error('Only JSON values can be sealed.')
  const header = concat(SEALED_MAGIC, new Uint8Array([SEALED_VERSION]))
  const payload = await gzip(new TextEncoder().encode(json))
  return concat(header, await mac(header, payload), payload)
}

/** Opens sealed bytes; `name` is the file name used in messages. */
export async function unseal(bytes: Uint8Array, name: string): Promise<ReadSealedResult> {
  const changed: ReadSealedResult = { status: 'tampered', message: `${name} was changed outside the app.` }
  if (bytes.length <= HEADER_LENGTH + MAC_LENGTH || !SEALED_MAGIC.every((byte, i) => bytes[i] === byte)) return changed

  const header = bytes.subarray(0, HEADER_LENGTH)
  const storedMac = bytes.subarray(HEADER_LENGTH, HEADER_LENGTH + MAC_LENGTH)
  const payload = bytes.subarray(HEADER_LENGTH + MAC_LENGTH)
  if (!(await macMatches(header, payload, storedMac))) return changed

  const version = bytes[SEALED_MAGIC.length]
  if (version > SEALED_VERSION) {
    return { status: 'unreadable', message: `${name} was saved by a newer version of the app; use the newer version.` }
  }
  if (version !== SEALED_VERSION) return changed

  try {
    return { status: 'ok', value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await gunzip(payload))) }
  } catch (error) {
    // Only possible for a file the app sealed itself, so it is damage rather than an outside edit.
    return { status: 'unreadable', message: `${name} could not be decoded: ${errorText(error)}` }
  }
}

/** Reads a sealed file: its value, or why it cannot be used. */
export async function readSealed(path: string): Promise<ReadSealedResult> {
  const { fs, path: paths } = platform()
  const name = paths.basename(path)
  let bytes: Uint8Array
  try {
    bytes = await fs.readFile(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { status: 'missing' }
    return { status: 'unreadable', message: `${name} could not be read: ${errorText(error)}` }
  }
  return unseal(bytes, name)
}

/** Seals a JSON value into `path` atomically, creating its folder if needed. */
export async function writeSealed(path: string, value: unknown): Promise<void> {
  const bytes = await seal(value)
  const { fs, path: paths } = platform()
  await fs.mkdir(paths.dirname(path))
  await writeFileAtomic(path, bytes)
}

// Web Crypto and CompressionStream exist in Node and in webviews, so these need no platform.

const macKey = crypto.subtle.importKey('raw', SEALED_FILE_KEY, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

async function mac(header: Uint8Array, payload: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await macKey, concat(header, payload)))
}

/** Compares in constant time (Web Crypto's verify). */
async function macMatches(header: Uint8Array, payload: Uint8Array, stored: Uint8Array): Promise<boolean> {
  return crypto.subtle.verify('HMAC', await macKey, new Uint8Array(stored), concat(header, payload))
}

function gzip(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream('gzip'))
}

function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('gzip'))
}

async function pipe(data: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)))
}
