/**
 * The print log: one CSV file per PC per month, `print-log-YYYY-MM-<PC>.csv`, append-only, one line
 * per print, GTIN or Custom Label. Each PC writes only its own files, so PCs sharing a log folder never write to the same
 * file; each line is a single append, so lines never interleave.
 */

import type { Label } from '../core/label'
import { packVolumeMlForDigit } from '../core/internalGtin'
import type { CustomLabel } from '../render/customLabel'
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
  'Copies',
  // Added in v0.3, at the end, so older files keep their columns.
  'Kind',
  'Template',
  'Code data',
  'Text'
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
  readonly kind: 'GTIN' | 'Custom'
  /** A Custom Label's Template name; empty for a GTIN Label (as are the next two). */
  readonly template: string
  readonly codeData: string
  /** A Custom Label's text lines, joined with " | ". */
  readonly text: string
}

type LogContext = { at: Date; windowsUser: string; pcName: string }

/** The log entry for a printed label. */
export function printLogEntryFor(label: Label, context: LogContext): PrintLogEntry {
  const yymmdd = label.expiryYymmdd
  return {
    ...context,
    itemCode: label.itemCode,
    packVolumeMl: packVolumeMlForDigit(label.packVolumeDigit),
    internalGtin: label.internalGtin,
    expiry: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
    lot: label.lot,
    copies: label.copies,
    kind: 'GTIN',
    template: '',
    codeData: '',
    text: ''
  }
}

/** The log entry for a printed Custom Label: the GTIN columns are left empty. */
export function customPrintLogEntryFor(label: CustomLabel, context: LogContext): PrintLogEntry {
  return {
    ...context,
    itemCode: '',
    packVolumeMl: null,
    internalGtin: '',
    expiry: '',
    lot: '',
    copies: label.copies,
    kind: 'Custom',
    template: label.templateName,
    codeData: label.codeValue,
    text: label.texts.join(' | ')
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
    String(entry.copies),
    entry.kind,
    entry.template,
    entry.codeData,
    entry.text
  ])
}

/** Appends one line for `entry` to its month file in `logFolder`; returns the file's path. */
export function appendPrintLog(logFolder: string, entry: PrintLogEntry): Promise<string> {
  return appendLogLine(logFolder, printLogFileName(entry.pcName, entry.at), PRINT_LOG_HEADER, printLogLine(entry))
}
