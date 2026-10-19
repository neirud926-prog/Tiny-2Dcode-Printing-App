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

import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { errorCode, errorText, writeFileAtomic } from './atomicWrite'

export const SEALED_MAGIC = Buffer.from('TDCP', 'latin1')
export const SEALED_VERSION = 1

/** Fixed forever for version 1: changing it makes every existing data file read as changed. */
export const SEALED_FILE_KEY = Buffer.from('77ab9371d9373823134124f6014cd11eddedb764373a9de39734c8434f99da3e', 'hex')

const HEADER_LENGTH = SEALED_MAGIC.length + 1
const MAC_LENGTH = 32

export type ReadSealedResult =
  | { status: 'ok'; value: unknown }
  | { status: 'missing' }
  | { status: 'tampered'; message: string }
  | { status: 'unreadable'; message: string }

/** The sealed bytes for a JSON value. Throws if JSON cannot hold the value. */
export function seal(value: unknown): Buffer {
  const json = JSON.stringify(value) as string | undefined
  if (json === undefined) throw new Error('Only JSON values can be sealed.')
  const header = Buffer.concat([SEALED_MAGIC, Buffer.from([SEALED_VERSION])])
  const payload = gzipSync(Buffer.from(json, 'utf8'))
  return Buffer.concat([header, mac(header, payload), payload])
}

/** Opens sealed bytes; `name` is the file name used in messages. */
export function unseal(bytes: Buffer, name: string): ReadSealedResult {
  const changed: ReadSealedResult = { status: 'tampered', message: `${name} was changed outside the app.` }
  if (bytes.length <= HEADER_LENGTH + MAC_LENGTH || !bytes.subarray(0, SEALED_MAGIC.length).equals(SEALED_MAGIC)) return changed

  const header = bytes.subarray(0, HEADER_LENGTH)
  const storedMac = bytes.subarray(HEADER_LENGTH, HEADER_LENGTH + MAC_LENGTH)
  const payload = bytes.subarray(HEADER_LENGTH + MAC_LENGTH)
  if (!timingSafeEqual(storedMac, mac(header, payload))) return changed

  const version = bytes[SEALED_MAGIC.length]
  if (version > SEALED_VERSION) {
    return { status: 'unreadable', message: `${name} was saved by a newer version of the app; use the newer version.` }
  }
  if (version !== SEALED_VERSION) return changed

  try {
    return { status: 'ok', value: JSON.parse(gunzipSync(payload).toString('utf8')) }
  } catch (error) {
    // Only possible for a file the app sealed itself, so it is damage rather than an outside edit.
    return { status: 'unreadable', message: `${name} could not be decoded: ${errorText(error)}` }
  }
}

/** Reads a sealed file: its value, or why it cannot be used. */
export async function readSealed(path: string): Promise<ReadSealedResult> {
  const name = basename(path)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { status: 'missing' }
    return { status: 'unreadable', message: `${name} could not be read: ${errorText(error)}` }
  }
  return unseal(bytes, name)
}

/** Seals a JSON value into `path` atomically, creating its folder if needed. */
export async function writeSealed(path: string, value: unknown): Promise<void> {
  const bytes = seal(value)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, bytes)
}

function mac(header: Buffer, payload: Buffer): Buffer {
  return createHmac('sha256', SEALED_FILE_KEY).update(header).update(payload).digest()
}
