/**
 * The import log: one CSV file per PC per month, `import-log-YYYY-MM-<PC>.csv`, append-only, one line
 * per import of the Item List, Stock Onhand or Topup Database, whether it was imported or refused.
 */
import { errorText } from './atomicWrite'
import { appendLogLine, csvLine, localDateTime, monthlyLogFileName } from './csvLog'

export const IMPORT_LOG_HEADER: readonly string[] = ['Date Time', 'Windows User', 'PC', 'Kind', 'File', 'Rows imported', 'Bad rows', 'Result']

export type ImportKind = 'Item List' | 'Stock Onhand' | 'Topup Database'

export interface ImportLogEntry {
  /** When the import ran (written as local time). */
  readonly at: Date
  readonly windowsUser: string
  readonly pcName: string
  readonly kind: ImportKind
  /** The full path of the file staff chose. */
  readonly file: string
  /** 0 when nothing was imported. */
  readonly rowsImported: number
  readonly badRows: number
  /** `Imported`, `Refused: <why>` (the file was not accepted) or `Failed: <why>` (it could not be read or saved). */
  readonly result: string
}

/** `import-log-YYYY-MM-<PC>.csv`, by the local month of `at`. */
export function importLogFileName(pcName: string, at: Date): string {
  return monthlyLogFileName('import-log', pcName, at)
}

/** One CSV line (CRLF-terminated). Date and time are local, `YYYY-MM-DD HH:mm:ss`. */
export function importLogLine(entry: ImportLogEntry): string {
  return csvLine([
    localDateTime(entry.at),
    entry.windowsUser,
    entry.pcName,
    entry.kind,
    entry.file,
    String(entry.rowsImported),
    String(entry.badRows),
    entry.result
  ])
}

/** Appends one line for `entry` to its month file in `logFolder`; returns the file's path. */
export function appendImportLog(logFolder: string, entry: ImportLogEntry): Promise<string> {
  return appendLogLine(logFolder, importLogFileName(entry.pcName, entry.at), IMPORT_LOG_HEADER, importLogLine(entry))
}

/**
 * Appends one line for `entry`, as `appendImportLog`. A log that cannot be written does not stop an
 * import: returns null, or the warning to show.
 */
export async function importLogWarning(logFolder: string, entry: ImportLogEntry): Promise<string | null> {
  try {
    await appendImportLog(logFolder, entry)
    return null
  } catch (error) {
    return `The import log could not be written: ${errorText(error)}`
  }
}
