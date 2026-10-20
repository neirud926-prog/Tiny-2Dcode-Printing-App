/**
 * The template log: one CSV file per PC per month, `template-log-YYYY-MM-<PC>.csv`, append-only, one
 * line per Template save, copy, rename or delete, whether it was done or refused.
 */
import { appendLogLine, csvLine, localDateTime, monthlyLogFileName } from './csvLog'

export const TEMPLATE_LOG_HEADER: readonly string[] = ['Date Time', 'Windows User', 'PC', 'Action', 'Template', 'Result']

export type TemplateAction = 'Save' | 'Copy' | 'Rename' | 'Delete'

export interface TemplateLogEntry {
  /** When it happened (written as local time). */
  readonly at: Date
  readonly windowsUser: string
  readonly pcName: string
  readonly action: TemplateAction
  /** The Template's name; `old → new` for a rename, `source → copy` for a copy. */
  readonly template: string
  /** `Saved`, `Copied`, `Renamed`, `Deleted`, or `Refused: <why>`. */
  readonly result: string
}

/** `template-log-YYYY-MM-<PC>.csv`, by the local month of `at`. */
export function templateLogFileName(pcName: string, at: Date): string {
  return monthlyLogFileName('template-log', pcName, at)
}

/** One CSV line (CRLF-terminated). Date and time are local, `YYYY-MM-DD HH:mm:ss`. */
export function templateLogLine(entry: TemplateLogEntry): string {
  return csvLine([localDateTime(entry.at), entry.windowsUser, entry.pcName, entry.action, entry.template, entry.result])
}

/** Appends one line for `entry` to its month file in `logFolder`; returns the file's path. */
export function appendTemplateLog(logFolder: string, entry: TemplateLogEntry): Promise<string> {
  return appendLogLine(logFolder, templateLogFileName(entry.pcName, entry.at), TEMPLATE_LOG_HEADER, templateLogLine(entry))
}
