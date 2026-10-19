/**
 * What happens when staff press Print or Test print, without Electron (the printer is passed in),
 * so it is tested end to end with a fake printer and a temp folder.
 *
 * The renderer sends only the label request. The label is rebuilt and self-checked here with the
 * main process's own date, and checked against the Item List (the Item Code must be listed; only a
 * liquid has a Pack Volume), so a label the label core or the Item List would refuse can never reach
 * the printer.
 */

import { localIsoDate } from '../core/expiry'
import { itemListProblems, lookupItem, type ItemIndex } from '../core/itemList'
import { buildLabel, selfCheckLabel, type Label, type LabelRequest } from '../core/label'
import { errorText } from '../data/atomicWrite'
import { resolveLogFolder } from '../data/pcSettings'
import { printLogEntryFor, type PrintLogEntry } from '../data/printLog'
import { buildLabelPrintJob, sampleLabelRequest, type LabelPrintJob } from '../render/printJob'
import type { PcSettings, PrintSettings } from '../render/printSettings'
import type { PrinterChoice, PrintOutcome } from '../preload/api'

/** What the printer driver said about a job. */
export type DriverResult = { ok: true } | { ok: false; reason: string }

export interface PrintServiceDeps {
  now(): Date
  /** Prints the job silently; resolves with the driver's result. */
  sendToPrinter(job: LabelPrintJob): Promise<DriverResult>
  appendLog(logFolder: string, entry: PrintLogEntry): Promise<unknown>
}

export interface PrintContext {
  readonly dataFolder: string
  readonly pcName: string
  readonly windowsUser: string
}

/**
 * Prints the label for `request` on this PC's printer and adds one print log line. `itemList` is the
 * Item List in use (null before one is imported).
 */
export async function printLabelRequest(
  request: unknown,
  settings: PcSettings | null,
  itemList: ItemIndex | null,
  context: PrintContext,
  deps: PrintServiceDeps
): Promise<PrintOutcome> {
  if (settings === null) return refused("set up this PC's printer first.")
  if (itemList === null) return refused('import the Item List first.')
  if (!isLabelRequest(request)) return refused('the label request is not valid.')

  const at = deps.now()
  const label = checkedLabel(request, localIsoDate(at))
  if (!label.ok) return refused(label.message)
  const problems = itemListProblems(lookupItem(itemList, label.label.itemCode), label.label)
  if (problems.length > 0) return refused(problems.map((problem) => problem.message).join(' '))

  const sent = await send(buildLabelPrintJob(label.label, settings), deps)
  if (!sent.ok) return refused(sent.message)

  const { copies } = label.label
  const message = `Printed ${copies} label${copies === 1 ? '' : 's'} on ${settings.printerName}.`
  try {
    await deps.appendLog(resolveLogFolder(context.dataFolder, settings), printLogEntryFor(label.label, { ...context, at }))
    return { ok: true, message, warning: null }
  } catch (error) {
    return { ok: true, message, warning: `The print log could not be written: ${errorText(error)}` }
  }
}

/**
 * Prints one sample label (Item Code TEST01, Lot TEST) so staff can check the printer, label size
 * and offsets before saving. Test prints carry no real Lot, so they are not written to the print log.
 */
export async function printTestLabel(settings: PrintSettings, deps: Pick<PrintServiceDeps, 'now' | 'sendToPrinter'>): Promise<PrintOutcome> {
  const today = localIsoDate(deps.now())
  const label = checkedLabel(sampleLabelRequest(today), today)
  if (!label.ok) return { ok: false, message: `Test print failed: ${label.message}` }
  const sent = await send(buildLabelPrintJob(label.label, settings), deps)
  if (!sent.ok) return { ok: false, message: `Test print failed: ${sent.message}` }
  return {
    ok: true,
    message: `Test label sent to ${settings.printerName}. If it is not centred on the label, adjust the offsets.`,
    warning: null
  }
}

/** Why a printer cannot be used, or null if it is installed. */
export function printerProblem(printerName: string, installed: readonly PrinterChoice[]): string | null {
  return installed.some((printer) => printer.name === printerName)
    ? null
    : `The printer "${printerName}" is not installed on this PC. Choose another printer.`
}

function refused(message: string): PrintOutcome {
  return { ok: false, message: `Not printed: ${message}` }
}

/** Builds the label and runs the self-check again, as the last gate before the printer. */
function checkedLabel(request: LabelRequest, today: string): { ok: true; label: Label } | { ok: false; message: string } {
  const built = buildLabel(request, { today })
  if (!built.ok) return { ok: false, message: built.errors.map((error) => error.message).join(' ') }
  const selfCheck = selfCheckLabel(built.label)
  if (!selfCheck.ok) return { ok: false, message: selfCheck.message }
  return { ok: true, label: built.label }
}

async function send(job: LabelPrintJob, deps: Pick<PrintServiceDeps, 'sendToPrinter'>): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const result = await deps.sendToPrinter(job)
    if (result.ok) return result
    return { ok: false, message: result.reason ? `the printer reported "${result.reason}".` : 'the printer reported a failure.' }
  } catch (error) {
    return { ok: false, message: errorText(error) }
  }
}

function isLabelRequest(value: unknown): value is LabelRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.itemCode === 'string' &&
    typeof record.packVolumeDigit === 'number' &&
    typeof record.expiry === 'string' &&
    typeof record.lot === 'string' &&
    typeof record.copies === 'number'
  )
}
