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
import type { Template } from '../core/template'
import { customPrintLogEntryFor, printLogEntryFor, type PrintLogEntry } from '../data/printLog'
import { buildCustomLabel, templateSizeProblem, type CustomLabelRequest } from '../render/customLabel'
import { buildCustomLabelPrintJob, buildLabelPrintJob, sampleLabelRequest, type LabelPrintJob } from '../render/printJob'
import { printSettingsFor, SMALL_LABEL, type LabelSizeEntry, type PcSettings, type PrintSettings } from '../render/printSettings'
import type { PrinterChoice, PrintOutcome } from '../preload/api'

import type { DriverResult } from './host'

export type { DriverResult }

export interface PrintServiceDeps {
  now(): Date
  /** Prints the job silently; resolves with the driver's result. */
  sendToPrinter(job: LabelPrintJob): Promise<DriverResult>
  appendLog(logFolder: string, entry: PrintLogEntry): Promise<unknown>
}

/** Why a GTIN Label is refused when another Label Size is loaded. */
export const GTIN_NEEDS_SMALL_LABEL = 'GTIN Labels print on the Small Label (34.4 × 25 mm). Change the label in Settings.'

/** GTIN Labels print only when the Small Label is loaded in this PC's printer. */
export function gtinLabelSizeProblem(settings: PcSettings): string | null {
  return settings.labelSizeId === SMALL_LABEL.id ? null : GTIN_NEEDS_SMALL_LABEL
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
  const sizeProblem = gtinLabelSizeProblem(settings)
  if (sizeProblem) return refused(sizeProblem)
  if (itemList === null) return refused('import the Item List first.')
  if (!isLabelRequest(request)) return refused('the label request is not valid.')

  const at = deps.now()
  const label = checkedLabel(request, localIsoDate(at))
  if (!label.ok) return refused(label.message)
  const problems = itemListProblems(lookupItem(itemList, label.label.itemCode), label.label)
  if (problems.length > 0) return refused(problems.map((problem) => problem.message).join(' '))

  const sent = await send(buildLabelPrintJob(label.label, printSettingsFor(settings, SMALL_LABEL)), deps)
  if (!sent.ok) return refused(sent.message)
  return logged(printLogEntryFor(label.label, { ...context, at }), settings, context, deps)
}

/** After a print: adds its print log line and says what printed. */
async function logged(entry: PrintLogEntry, settings: PcSettings, context: PrintContext, deps: PrintServiceDeps): Promise<PrintOutcome> {
  const { copies } = entry
  const message = `Printed ${copies} label${copies === 1 ? '' : 's'} on ${settings.printerName}.`
  try {
    await deps.appendLog(resolveLogFolder(context.dataFolder, settings), entry)
    return { ok: true, message, warning: null }
  } catch (error) {
    return { ok: true, message, warning: `The print log could not be written: ${errorText(error)}` }
  }
}

/**
 * Prints a Custom Label from one of `templates` on this PC's printer and adds one print log line.
 * The label is rebuilt and checked here; the Template must be made for the Label Size loaded
 * (`sizes` is the Label Size list), and prints with that size's offsets.
 */
export async function printCustomLabelRequest(
  request: unknown,
  settings: PcSettings | null,
  sizes: readonly LabelSizeEntry[],
  templates: readonly Template[],
  context: PrintContext,
  deps: PrintServiceDeps
): Promise<PrintOutcome> {
  if (settings === null) return refused("set up this PC's printer first.")
  if (!isCustomLabelRequest(request)) return refused('the label request is not valid.')
  const template = templates.find((entry) => entry.id === request.templateId)
  if (!template) return refused('that template is no longer there.')
  const sizeProblem = templateSizeProblem(template, settings.labelSizeId, sizes)
  if (sizeProblem) return refused(sizeProblem)
  const size = sizes.find((entry) => entry.id === settings.labelSizeId)
  if (!size) return refused('the label size in this printer is no longer in the list. Change the label in Settings.')

  const at = deps.now()
  const built = buildCustomLabel(template, size, request)
  if (!built.ok) return refused(built.errors.map((error) => error.message).join(' '))

  const sent = await send(buildCustomLabelPrintJob(built.label, printSettingsFor(settings, size)), deps)
  if (!sent.ok) return refused(sent.message)
  return logged(customPrintLogEntryFor(built.label, { ...context, at }), settings, context, deps)
}

/**
 * Prints one sample label (Item Code TEST01, Lot TEST) on the loaded Label Size with its offsets,
 * so staff can check the printer and offsets before saving. Test prints carry no real Lot, so they are not written to the print log.
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

function isCustomLabelRequest(value: unknown): value is CustomLabelRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.templateId === 'string' &&
    (record.symbology === 'datamatrix' || record.symbology === 'qr') &&
    typeof record.codeValue === 'string' &&
    Array.isArray(record.texts) &&
    record.texts.every((text) => typeof text === 'string') &&
    typeof record.copies === 'number'
  )
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
