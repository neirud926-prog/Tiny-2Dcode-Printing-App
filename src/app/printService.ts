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
import { itemListProblems, lookupItem, MAX_ECHOED_ITEM_CODE_LENGTH, upperCaseAscii, type ItemIndex } from '../core/itemList'
import { buildLabel, selfCheckLabel, type Label, type LabelRequest } from '../core/label'
import { errorText } from '../data/atomicWrite'
import { resolveLogFolder } from '../data/pcSettings'
import type { Template } from '../core/template'
import { lookupTopup, topupContent, type TopupIndex } from '../core/topup'
import { customPrintLogEntryFor, printLogEntryFor, topupPrintLogEntryFor, type PrintLogEntry } from '../data/printLog'
import { buildCustomLabel, templateSizeProblem, type CustomLabelRequest } from '../render/customLabel'
import { buildCustomLabelPrintJob, buildLabelPrintJob, buildTapeTestPrintJob, buildTopupLabelPrintJob, sampleLabelRequest, type LabelPrintJob } from '../render/printJob'
import { GTIN_LABEL_SIZE_REFUSAL, gtinTapeLengthProblem, isGtinLabelSize } from '../render/gtinTapeLabel'
import { printSettingsFor, TOPUP_TAPE_SIZE, type LabelSizeEntry, type PcSettings, type PrintSettings } from '../render/printSettings'
import { buildTopupLabel, TOPUP_LABEL_SIZE_REFUSAL } from '../render/topupLabel'
import type { PrinterChoice, PrintOutcome, TopupLabelRequest } from '../preload/api'

import type { DriverPaper, DriverResult } from './host'

export type { DriverResult }

export interface PrintServiceDeps {
  now(): Date
  /** The printer driver's default paper, or null if it cannot be read (ADR 0004). */
  readDefaultPaper(printerName: string): Promise<DriverPaper | null>
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
 * Prints the label for `request` on this PC's printer and adds one print log line. `sizes` is the
 * Label Size list: the loaded size must be the Small Label or 18, 24 or 36 mm tape, which gets the
 * GTIN tape layout and must be long enough for it. `itemList` is the Item List in use (null before
 * one is imported).
 */
export async function printLabelRequest(
  request: unknown,
  settings: PcSettings | null,
  sizes: readonly LabelSizeEntry[],
  itemList: ItemIndex | null,
  context: PrintContext,
  deps: PrintServiceDeps
): Promise<PrintOutcome> {
  if (settings === null) return refused("set up this PC's printer first.")
  const size = sizes.find((entry) => entry.id === settings.labelSizeId)
  if (!size || !isGtinLabelSize(size)) return refused(GTIN_LABEL_SIZE_REFUSAL)
  if (itemList === null) return refused('import the Item List first.')
  if (!isLabelRequest(request)) return refused('the label request is not valid.')

  const at = deps.now()
  const label = checkedLabel(request, localIsoDate(at))
  if (!label.ok) return refused(label.message)
  const problems = itemListProblems(lookupItem(itemList, label.label.itemCode), label.label)
  if (problems.length > 0) return refused(problems.map((problem) => problem.message).join(' '))

  const lengthProblem = gtinTapeLengthProblem(label.label, size, settings.printerResolution)
  if (lengthProblem) return refused(lengthProblem)

  const printSettings = printSettingsFor(settings, size)
  const sent = await send(buildLabelPrintJob(label.label, printSettings), printSettings, deps)
  if (!sent.ok) return refused(sent.message)
  return logged(printLogEntryFor(label.label, { ...context, at }), settings, context, deps, sent.warning)
}

/** After a print: adds its print log line and says what printed, with `warning` from the print. */
async function logged(
  entry: PrintLogEntry,
  settings: PcSettings,
  context: PrintContext,
  deps: PrintServiceDeps,
  warning: string | null
): Promise<PrintOutcome> {
  const { copies } = entry
  const message = `Printed ${copies} label${copies === 1 ? '' : 's'} on ${settings.printerName}.`
  try {
    await deps.appendLog(resolveLogFolder(context.dataFolder, settings), entry)
    return { ok: true, message, warning }
  } catch (error) {
    const logWarning = `The print log could not be written: ${errorText(error)}`
    return { ok: true, message, warning: warning ? `${warning} ${logWarning}` : logWarning }
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
  const built = buildCustomLabel(template, size, request, settings.printerResolution)
  if (!built.ok) return refused(built.errors.map((error) => error.message).join(' '))

  const printSettings = printSettingsFor(settings, size)
  const sent = await send(buildCustomLabelPrintJob(built.label, printSettings), printSettings, deps)
  if (!sent.ok) return refused(sent.message)
  return logged(customPrintLogEntryFor(built.label, { ...context, at }), settings, context, deps, sent.warning)
}

/**
 * Prints the Topup Label for `request` on this PC's printer and adds one print log line (Kind
 * Custom, Template Topup). The loaded Label Size must be the built-in Tape Size "24 mm tape × 26 mm"; the code content
 * comes from `topup`, the Topup Database in use, and the label is laid out here at this PC's
 * Printer resolution.
 */
export async function printTopupLabelRequest(
  request: unknown,
  settings: PcSettings | null,
  topup: TopupIndex,
  context: PrintContext,
  deps: PrintServiceDeps
): Promise<PrintOutcome> {
  if (settings === null) return refused("set up this PC's printer first.")
  if (settings.labelSizeId !== TOPUP_TAPE_SIZE.id) return refused(TOPUP_LABEL_SIZE_REFUSAL)
  if (!isTopupLabelRequest(request)) return refused('the label request is not valid.')
  const entry = lookupTopup(topup, request.itemCode)
  if (!entry) return refused(`${upperCaseAscii(request.itemCode.slice(0, MAX_ECHOED_ITEM_CODE_LENGTH))} is not in the Topup Database.`)

  const at = deps.now()
  const built = buildTopupLabel({ itemCode: entry.itemCode, content: topupContent(entry), symbology: request.symbology, copies: request.copies }, settings.printerResolution)
  if (!built.ok) return refused(built.message)

  const printSettings = printSettingsFor(settings, TOPUP_TAPE_SIZE)
  const sent = await send(buildTopupLabelPrintJob(built.label, printSettings), printSettings, deps)
  if (!sent.ok) return refused(sent.message)
  return logged(topupPrintLogEntryFor(built.label, { ...context, at }), settings, context, deps, sent.warning)
}

/**
 * Prints one sample label (Item Code TEST01, Lot TEST) on `size` (the loaded Label Size) with its
 * offsets, so staff can check the printer and offsets before saving; on a Tape Size it prints the
 * label outline, the printable band edges and the size name instead. Test prints carry no real Lot,
 * so they are not written to the print log.
 */
export async function printTestLabel(
  settings: PcSettings,
  size: LabelSizeEntry,
  deps: Pick<PrintServiceDeps, 'now' | 'readDefaultPaper' | 'sendToPrinter'>
): Promise<PrintOutcome> {
  const printSettings = printSettingsFor(settings, size)
  let job: LabelPrintJob
  if (size.kind === 'tape') job = buildTapeTestPrintJob(size, printSettings)
  else {
    const today = localIsoDate(deps.now())
    const label = checkedLabel(sampleLabelRequest(today), today)
    if (!label.ok) return { ok: false, message: `Test print failed: ${label.message}` }
    job = buildLabelPrintJob(label.label, printSettings)
  }
  const sent = await send(job, printSettings, deps)
  if (!sent.ok) return { ok: false, message: `Test print failed: ${sent.message}` }
  return {
    ok: true,
    message: `Test label sent to ${settings.printerName}. If it is not centred on the label, adjust the offsets.`,
    warning: sent.warning
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

/**
 * Sends `job`, printed with `settings`, to the printer; every print goes through here. On a Tape Size
 * the driver's default paper is checked first (ADR 0004): a known tape width mismatch is refused and
 * nothing is sent; a known length mismatch, or a driver that reports nothing, prints with a warning.
 */
async function send(
  job: LabelPrintJob,
  settings: PrintSettings,
  deps: Pick<PrintServiceDeps, 'readDefaultPaper' | 'sendToPrinter'>
): Promise<{ ok: true; warning: string | null } | { ok: false; message: string }> {
  let warning: string | null = null
  if (settings.labelSize.kind === 'tape') {
    const tape = await tapeCheck(settings, deps)
    if (!tape.ok) return tape
    warning = tape.warning
  }
  try {
    const result = await deps.sendToPrinter(job)
    if (result.ok) return { ok: true, warning }
    return { ok: false, message: result.reason ? `the printer reported "${result.reason}".` : 'the printer reported a failure.' }
  } catch (error) {
    return { ok: false, message: errorText(error) }
  }
}

/** Driver widths and lengths are in tenths of a mm and may round (23.9 for 24 mm tape). */
const PAPER_TOLERANCE_MM = 0.5

/**
 * Checks the driver's default paper against the Tape Size in `settings` (length × tape width): only
 * the tape width refuses, since driver papers may carry a fixed nominal length.
 */
async function tapeCheck(
  settings: PrintSettings,
  deps: Pick<PrintServiceDeps, 'readDefaultPaper'>
): Promise<{ ok: true; warning: string | null } | { ok: false; message: string }> {
  const { widthMm: lengthMm, heightMm: tapeWidthMm } = settings.labelSize
  let paper: DriverPaper | null
  try {
    paper = await deps.readDefaultPaper(settings.printerName)
  } catch {
    paper = null
  }
  if (paper === null) {
    return { ok: true, warning: `Could not check the tape width; check the printer is set to ${tapeWidthMm} mm tape.` }
  }
  if (Math.abs(paper.widthMm - tapeWidthMm) > PAPER_TOLERANCE_MM) {
    return { ok: false, message: `The printer is set to ${mm(paper.widthMm)} mm tape; set ${tapeWidthMm} mm in its Printing preferences.` }
  }
  if (paper.lengthMm !== null && Math.abs(paper.lengthMm - lengthMm) > PAPER_TOLERANCE_MM) {
    return {
      ok: true,
      warning: `The printer is set to ${mm(paper.lengthMm)} mm long labels; set ${lengthMm} mm in its Printing preferences so each label is ${lengthMm} mm.`
    }
  }
  return { ok: true, warning: null }
}

/** Every tape check message names what the printer is set to (see tapeCheck). */
const TAPE_CHECK_MESSAGE = /printer is set to [\d.]+ mm/

/**
 * Whether `outcome` came with a tape check refusal or warning (ADR 0004), or the refusal of a Topup
 * Label on another Label Size, so the screen shows the "How to set the printer" link next to it.
 */
export function showsPrinterGuide(outcome: PrintOutcome | { ok: false; message: string } | null): boolean {
  if (outcome === null) return false
  if (outcome.ok) return TAPE_CHECK_MESSAGE.test(outcome.warning ?? '')
  return TAPE_CHECK_MESSAGE.test(outcome.message) || outcome.message.includes(TOPUP_LABEL_SIZE_REFUSAL)
}

/** A driver length in mm, to a tenth (`23.9`, `36`). */
function mm(value: number): string {
  return String(Number(value.toFixed(1)))
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

function isTopupLabelRequest(value: unknown): value is TopupLabelRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.itemCode === 'string' && (record.symbology === 'datamatrix' || record.symbology === 'qr') && typeof record.copies === 'number'
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
