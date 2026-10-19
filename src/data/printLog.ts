/**
 * The print log: one CSV file per PC per month, `print-log-YYYY-MM-<PC>.csv`, append-only, one line
 * per print. Each PC writes only its own files, so PCs sharing a log folder never write to the same
 * file; each line is a single append, so lines never interleave.
 */

import type { Label } from '../core/label'
import { packVolumeMlForDigit } from '../core/internalGtin'
import { appendLogLine, csvLine, localDateTime, monthlyLogFileName } from './csvLog'

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
  return monthlyLogFileName('print-log', pcName, at)
}

/** One CSV line (CRLF-terminated). Date and time are local, `YYYY-MM-DD HH:mm:ss`. */
export function printLogLine(entry: PrintLogEntry): string {
  return csvLine([
    localDateTime(entry.at),
    entry.windowsUser,
    entry.pcName,
    entry.itemCode,
    entry.packVolumeMl === null ? '' : String(entry.packVolumeMl),
    entry.internalGtin,
    entry.expiry,
    entry.lot,
    String(entry.copies)
  ])
}

/** Appends one line for `entry` to its month file in `logFolder`; returns the file's path. */
export function appendPrintLog(logFolder: string, entry: PrintLogEntry): Promise<string> {
  return appendLogLine(logFolder, printLogFileName(entry.pcName, entry.at), PRINT_LOG_HEADER, printLogLine(entry))
}
