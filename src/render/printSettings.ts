/**
 * This PC's printer settings: which printer, the label roll's size, and the offsets that line the
 * print up with the label. Stored per PC in `pcs/<PC name>.dat`; validated here so the main process
 * (authoritative) and the settings form (live feedback) apply the same rules.
 *
 * Pure: no Node, DOM or Electron.
 */

import { DOT_MM } from './dataMatrix'
import { DEFAULT_LABEL_SIZE, type LabelSize } from './labelSvg'

/** What the print job needs from the settings. */
export interface PrintSettings {
  /** The printer's system name, as Electron lists it (passed to the driver as the device name). */
  readonly printerName: string
  readonly labelSize: LabelSize
  /** Moves the print right (positive) or left, in mm; always whole printer dots. */
  readonly offsetXmm: number
  /** Moves the print down (positive) or up, in mm; always whole printer dots. */
  readonly offsetYmm: number
}

/** Everything kept for one PC. */
export interface PcSettings extends PrintSettings {
  /** Where print logs go; null means `logs` in the data folder. */
  readonly logFolder: string | null
}

export const DEFAULT_PC_SETTINGS: PcSettings = {
  printerName: '',
  labelSize: DEFAULT_LABEL_SIZE,
  offsetXmm: 0,
  offsetYmm: 0,
  logFolder: null
}

export const LABEL_SIZE_LIMITS_MM = { min: 10, max: 150 } as const
export const MAX_OFFSET_MM = 10

export type PcSettingsField = 'printerName' | 'widthMm' | 'heightMm' | 'offsetXmm' | 'offsetYmm' | 'logFolder'

export interface PcSettingsMessage {
  readonly field: PcSettingsField
  readonly message: string
}

export type NormalisePcSettingsResult = { ok: true; settings: PcSettings } | { ok: false; errors: PcSettingsMessage[] }

/**
 * An offset rounded to whole printer dots, so the symbol stays on the dot grid and every module
 * prints exactly 3 dots.
 */
export function snapToPrinterDots(mm: number): number {
  const dots = Math.round(mm / DOT_MM)
  return dots === 0 ? 0 : dots * DOT_MM
}

/** An offset (already snapped) as a whole number of printer dots. */
export function offsetInDots(mm: number): number {
  return Math.round(mm / DOT_MM)
}

/**
 * Checks settings from anywhere (the form, IPC, a settings file) and returns them cleaned up:
 * printer name trimmed, label size rounded to 0.01 mm, offsets snapped to whole printer dots.
 */
export function normalisePcSettings(input: unknown): NormalisePcSettingsResult {
  const errors: PcSettingsMessage[] = []
  const record = isRecord(input) ? input : {}
  const labelSize = isRecord(record.labelSize) ? record.labelSize : {}

  const printerName = typeof record.printerName === 'string' ? record.printerName.trim() : ''
  if (printerName === '') errors.push({ field: 'printerName', message: 'Choose a printer.' })

  const widthMm = sizeMm(labelSize.widthMm, 'widthMm', 'Label width')
  const heightMm = sizeMm(labelSize.heightMm, 'heightMm', 'Label height')
  const offsetXmm = offsetMm(record.offsetXmm, 'offsetXmm', 'Offset X')
  const offsetYmm = offsetMm(record.offsetYmm, 'offsetYmm', 'Offset Y')

  const logFolder = record.logFolder === null || (typeof record.logFolder === 'string' && record.logFolder.trim() !== '') ? record.logFolder : undefined
  if (logFolder === undefined) errors.push({ field: 'logFolder', message: 'Choose a log folder.' })

  if (errors.length > 0 || widthMm === null || heightMm === null || offsetXmm === null || offsetYmm === null || logFolder === undefined) {
    return { ok: false, errors }
  }
  return { ok: true, settings: { printerName, labelSize: { widthMm, heightMm }, offsetXmm, offsetYmm, logFolder } }

  function sizeMm(value: unknown, field: PcSettingsField, name: string): number | null {
    const { min, max } = LABEL_SIZE_LIMITS_MM
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      errors.push({ field, message: `${name} must be from ${min} to ${max} mm.` })
      return null
    }
    return Math.round(value * 100) / 100
  }

  function offsetMm(value: unknown, field: PcSettingsField, name: string): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_OFFSET_MM) {
      errors.push({ field, message: `${name} must be from -${MAX_OFFSET_MM} to ${MAX_OFFSET_MM} mm.` })
      return null
    }
    return snapToPrinterDots(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
