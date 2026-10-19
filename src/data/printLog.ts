/**
 * The print log: one CSV file per PC per month, `print-log-YYYY-MM-<PC>.csv`, append-only, one line
 * per print. Each PC writes only its own files, so PCs sharing a log folder never write to the same
 * file; each line is a single append, so lines never interleave.
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Label } from '../core/label'
import { packVolumeMlForDigit } from '../core/internalGtin'
import { errorCode } from './atomicWrite'

export const PRINT_LOG_HEADER: readonly string[] = [
  'Date Time',
  'Windows User',
  'PC',
  'Item Code',
  'Pack Volume (mL)',
  'Internal GTIN',
  'Expiry',
  'Lot',
  'Copies'
]

export interface PrintLogEntry {
  /** When the label printed (written as local time). */
  readonly at: Date
  readonly windowsUser: string
  readonly pcName: string
  readonly itemCode: string
  /** Null when no Pack Volume is encoded. */
  readonly packVolumeMl: number | null
  readonly internalGtin: string
  /** `YYYY-MM-DD`. */
  readonly expiry: string
  readonly lot: string
  readonly copies: number
}

/** The log entry for a printed label. */
export function printLogEntryFor(label: Label, context: { at: Date; windowsUser: string; pcName: string }): PrintLogEntry {
  const yymmdd = label.expiryYymmdd
  return {
    ...context,
    itemCode: label.itemCode,
    packVolumeMl: packVolumeMlForDigit(label.packVolumeDigit),
    internalGtin: label.internalGtin,
    expiry: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
    lot: label.lot,
    copies: label.copies
  }
}

/** `print-log-YYYY-MM-<PC>.csv`, by the local month of `at`. */
export function printLogFileName(pcName: string, at: Date): string {
  return `print-log-${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pcName}.csv`
}

/** One CSV line (CRLF-terminated). Date and time are local, `YYYY-MM-DD HH:mm:ss`. */
export function printLogLine(entry: PrintLogEntry): string {
  return (
    [
      localDateTime(entry.at),
      entry.windowsUser,
      entry.pcName,
      entry.itemCode,
      entry.packVolumeMl === null ? '' : String(entry.packVolumeMl),
      entry.internalGtin,
      entry.expiry,
      entry.lot,
      String(entry.copies)
    ]
      .map(csvField)
      .join(',') + '\r\n'
  )
}

/** A CSV field, quoted only when it holds a comma, quote, line break or leading/trailing space. */
export function csvField(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Appends one line for `entry` to its month file in `logFolder`; returns the file's path. */
export function appendPrintLog(logFolder: string, entry: PrintLogEntry): Promise<string> {
  const path = join(logFolder, printLogFileName(entry.pcName, entry.at))
  return queued(path, async () => {
    await mkdir(logFolder, { recursive: true })
    const line = printLogLine(entry)
    try {
      // A new file gets the header row and the line in one write.
      await writeFile(path, PRINT_LOG_HEADER.map(csvField).join(',') + '\r\n' + line, { flag: 'wx' })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      await appendFile(path, line)
    }
    return path
  })
}

/**
 * Runs file tasks one at a time per path, so a header row is always first even if this PC prints
 * twice at once. (Only this PC writes its files, and the app runs once per PC.)
 */
const queues = new Map<string, Promise<unknown>>()

function queued<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve()
  const result = previous.then(task, task)
  const settled = result.catch(() => undefined)
  queues.set(path, settled)
  void settled.then(() => {
    if (queues.get(path) === settled) queues.delete(path)
  })
  return result
}

function localDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
