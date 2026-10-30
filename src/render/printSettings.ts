/**
 * This PC's printer settings: which printer, the Label Size loaded in it, and per Label Size the
 * offsets that line the print up with the label. Stored per PC in `pcs/<PC name>.dat`; validated
 * here so the app service (authoritative) and the settings form (live feedback) apply the same rules.
 * Also the Label Sizes themselves, shared by every PC, with the built-in Small Label.
 *
 * Pure: no Node, DOM or Electron.
 */

import { DEFAULT_PRINTER_RESOLUTION, dotMm, PRINTER_RESOLUTIONS, type PrinterResolution } from './dataMatrix'
import { DEFAULT_LABEL_SIZE, type LabelSize } from './labelSvg'
import { isTapeWidthMm, TAPE_WIDTHS_MM, tapeSizeName } from './tapeSize'

/** What the print job needs from the settings. */
export interface PrintSettings {
  /** The printer's system name, as Electron lists it (passed to the driver as the device name). */
  readonly printerName: string
  /** Sizes the 2D code's modules in whole dots. */
  readonly printerResolution: PrinterResolution
  readonly labelSize: LabelSize
  /** Moves the print right (positive) or left, in mm; always whole printer dots. */
  readonly offsetXmm: number
  /** Moves the print down (positive) or up, in mm; always whole printer dots. */
  readonly offsetYmm: number
  /** The label is on tape: the job uses the driver's paper and turns the label to run along the tape. */
  readonly onTape?: boolean
}

/** A die-cut label, or continuous tape (a Tape Size). */
export type LabelSizeKind = 'label' | 'tape'

/**
 * A Label Size: a named label roll in the list shared by every PC. The Small Label is built in,
 * always first, and never stored or changed.
 */
export interface LabelSizeEntry extends LabelSize {
  readonly id: string
  readonly name: string
  /**
   * For a Tape Size the label is laid out as it reads along the tape: `widthMm` is the label length
   * and `heightMm` the tape width (one of `TAPE_WIDTHS_MM`).
   */
  readonly kind: LabelSizeKind
}

export const SMALL_LABEL: LabelSizeEntry = { id: 'small-label', name: 'Small Label', kind: 'label', ...DEFAULT_LABEL_SIZE }

export const LABEL_SIZE_LIMITS_MM = { min: 10, max: 150 } as const
export const MAX_LABEL_SIZE_NAME_LENGTH = 40
export const MAX_OFFSET_MM = 10

/** The offsets that line the print up on one Label Size. */
export interface SizeOffsets {
  readonly offsetXmm: number
  readonly offsetYmm: number
}

/** Everything kept for one PC. */
export interface PcSettings {
  /** The printer's system name (passed to the driver as the device name). */
  readonly printerName: string
  /** The printer's dots per inch: 2D code modules and offsets are whole dots at it. */
  readonly printerResolution: PrinterResolution
  /** The Label Size loaded in this PC's printer. */
  readonly labelSizeId: string
  /** Offsets per Label Size id, so swapping rolls needs no recalibration; a size not listed has none. */
  readonly offsets: Readonly<Record<string, SizeOffsets>>
  /** Where print logs go; null means `logs` in the data folder. */
  readonly logFolder: string | null
}

export const DEFAULT_PC_SETTINGS: PcSettings = {
  printerName: '',
  printerResolution: DEFAULT_PRINTER_RESOLUTION,
  labelSizeId: SMALL_LABEL.id,
  offsets: {},
  logFolder: null
}

/** This PC's offsets for a Label Size (none if never set). */
export function offsetsFor(settings: Pick<PcSettings, 'offsets'>, labelSizeId: string): SizeOffsets {
  return Object.hasOwn(settings.offsets, labelSizeId) ? settings.offsets[labelSizeId] : { offsetXmm: 0, offsetYmm: 0 }
}

/** What a print job on `size` needs from this PC's settings. */
export function printSettingsFor(settings: PcSettings, size: LabelSizeEntry): PrintSettings {
  return {
    printerName: settings.printerName,
    printerResolution: settings.printerResolution,
    labelSize: { widthMm: size.widthMm, heightMm: size.heightMm },
    ...offsetsFor(settings, size.id),
    ...(size.kind === 'tape' ? { onTape: true } : {})
  }
}

/** e.g. `34.4 × 25 mm`, or `24 mm tape × 40 mm` for a Tape Size. */
export function formatLabelSizeMm(size: LabelSize & { readonly kind?: LabelSizeKind }): string {
  return size.kind === 'tape' ? tapeSizeName(size.heightMm, size.widthMm) : `${size.widthMm} × ${size.heightMm} mm`
}

export type PcSettingsField = 'printerName' | 'printerResolution' | 'labelSizeId' | 'offsetXmm' | 'offsetYmm' | 'logFolder'

export interface PcSettingsMessage {
  readonly field: PcSettingsField
  readonly message: string
}

export type NormalisePcSettingsResult = { ok: true; settings: PcSettings } | { ok: false; errors: PcSettingsMessage[] }

export type LabelSizeField = 'name' | 'widthMm' | 'heightMm' | 'tapeWidthMm' | 'lengthMm'

export type NormaliseLabelSizeResult =
  | { ok: true; size: Omit<LabelSizeEntry, 'id'> }
  | { ok: false; errors: { readonly field: LabelSizeField; readonly message: string }[] }

/**
 * Checks a Label Size to add: name trimmed (1–40 characters), width and height within the limits,
 * rounded to 0.01 mm. A Tape Size (`kind: 'tape'`) gives a tape width, one of `TAPE_WIDTHS_MM`, and a
 * length within the limits; a blank name becomes "<w> mm tape × <l> mm".
 */
export function normaliseLabelSize(input: unknown): NormaliseLabelSizeResult {
  const record = isRecord(input) ? input : {}
  const errors: { field: LabelSizeField; message: string }[] = []
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (record.kind === 'tape') return normaliseTapeSize(record, name)
  if (name === '') errors.push({ field: 'name', message: 'Enter a name for the label size.' })
  else if (name.length > MAX_LABEL_SIZE_NAME_LENGTH) errors.push({ field: 'name', message: `The name must be at most ${MAX_LABEL_SIZE_NAME_LENGTH} characters.` })
  const widthMm = sizeMm(record.widthMm)
  if (widthMm === null) errors.push({ field: 'widthMm', message: sizeMessage('Label width') })
  const heightMm = sizeMm(record.heightMm)
  if (heightMm === null) errors.push({ field: 'heightMm', message: sizeMessage('Label height') })
  if (errors.length > 0 || widthMm === null || heightMm === null) return { ok: false, errors }
  return { ok: true, size: { name, kind: 'label', widthMm, heightMm } }
}

function normaliseTapeSize(record: Record<string, unknown>, typedName: string): NormaliseLabelSizeResult {
  const errors: { field: LabelSizeField; message: string }[] = []
  const tapeWidthMm = isTapeWidthMm(record.tapeWidthMm) ? record.tapeWidthMm : null
  const lengthMm = sizeMm(record.lengthMm)
  const name = typedName === '' && tapeWidthMm !== null && lengthMm !== null ? tapeSizeName(tapeWidthMm, lengthMm) : typedName
  if (name.length > MAX_LABEL_SIZE_NAME_LENGTH) errors.push({ field: 'name', message: `The name must be at most ${MAX_LABEL_SIZE_NAME_LENGTH} characters.` })
  if (tapeWidthMm === null) errors.push({ field: 'tapeWidthMm', message: `Tape width must be ${TAPE_WIDTHS_MM.slice(0, -1).join(', ')} or ${TAPE_WIDTHS_MM.at(-1)} mm.` })
  if (lengthMm === null) errors.push({ field: 'lengthMm', message: sizeMessage('Label length') })
  if (errors.length > 0 || tapeWidthMm === null || lengthMm === null) return { ok: false, errors }
  return { ok: true, size: { name, kind: 'tape', widthMm: lengthMm, heightMm: tapeWidthMm } }
}

/** A label width or height rounded to 0.01 mm, or null if outside the limits. */
export function sizeMm(value: unknown): number | null {
  const { min, max } = LABEL_SIZE_LIMITS_MM
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null
  return Math.round(value * 100) / 100
}

function sizeMessage(name: string): string {
  return `${name} must be from ${LABEL_SIZE_LIMITS_MM.min} to ${LABEL_SIZE_LIMITS_MM.max} mm.`
}

/**
 * An offset rounded to whole printer dots at `dpi`, so the symbol stays on the dot grid and every
 * module prints exactly the same number of dots.
 */
export function snapToPrinterDots(mm: number, dpi: PrinterResolution): number {
  const dots = Math.round(mm / dotMm(dpi))
  return dots === 0 ? 0 : dots * dotMm(dpi)
}

/** An offset (already snapped) as a whole number of printer dots at `dpi`. */
export function offsetInDots(mm: number, dpi: PrinterResolution): number {
  return Math.round(mm / dotMm(dpi))
}

/**
 * Checks settings from anywhere (the form, the renderer, a settings file) and returns them cleaned
 * up: printer name trimmed, offsets snapped to whole dots at the Printer resolution (203 dpi when
 * not given, as in settings saved before it existed). Whether the Label Size exists is
 * checked against the shared list by the caller.
 */
export function normalisePcSettings(input: unknown): NormalisePcSettingsResult {
  const errors: PcSettingsMessage[] = []
  const record = isRecord(input) ? input : {}

  const printerName = typeof record.printerName === 'string' ? record.printerName.trim() : ''
  if (printerName === '') errors.push({ field: 'printerName', message: 'Choose a printer.' })

  const printerResolution = record.printerResolution === undefined ? DEFAULT_PRINTER_RESOLUTION : PRINTER_RESOLUTIONS.find((dpi) => dpi === record.printerResolution)
  if (printerResolution === undefined) errors.push({ field: 'printerResolution', message: 'Choose the printer resolution.' })

  const labelSizeId = typeof record.labelSizeId === 'string' ? record.labelSizeId : ''
  if (labelSizeId === '') errors.push({ field: 'labelSizeId', message: 'Choose the label in this printer.' })

  const offsets: Record<string, SizeOffsets> = {}
  for (const [id, entry] of Object.entries(isRecord(record.offsets) ? record.offsets : {})) {
    const values = isRecord(entry) ? entry : {}
    const offsetXmm = offsetMm(values.offsetXmm, 'offsetXmm', 'Offset X')
    const offsetYmm = offsetMm(values.offsetYmm, 'offsetYmm', 'Offset Y')
    if (offsetXmm !== null && offsetYmm !== null) offsets[id] = { offsetXmm, offsetYmm }
  }
  if (!isRecord(record.offsets)) errors.push({ field: 'offsetXmm', message: 'The offsets are not valid.' })

  const logFolder = record.logFolder === null || (typeof record.logFolder === 'string' && record.logFolder.trim() !== '') ? record.logFolder : undefined
  if (logFolder === undefined) errors.push({ field: 'logFolder', message: 'Choose a log folder.' })

  if (errors.length > 0 || logFolder === undefined || printerResolution === undefined) return { ok: false, errors }
  return { ok: true, settings: { printerName, printerResolution, labelSizeId, offsets, logFolder } }

  function offsetMm(value: unknown, field: PcSettingsField, name: string): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_OFFSET_MM) {
      errors.push({ field, message: `${name} must be from -${MAX_OFFSET_MM} to ${MAX_OFFSET_MM} mm.` })
      return null
    }
    return snapToPrinterDots(value, printerResolution ?? DEFAULT_PRINTER_RESOLUTION)
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
