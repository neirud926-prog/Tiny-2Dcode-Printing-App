import { describe, expect, it } from 'vitest'
import { DOT_MM } from './dataMatrix'
import { DEFAULT_LABEL_SIZE } from './labelSvg'
import {
  DEFAULT_PC_SETTINGS,
  LABEL_SIZE_LIMITS_MM,
  MAX_OFFSET_MM,
  normalisePcSettings,
  offsetInDots,
  snapToPrinterDots,
  type PcSettings
} from './printSettings'

const valid: PcSettings = {
  printerName: 'ZDesigner GX420t',
  labelSize: { widthMm: 34.4, heightMm: 25 },
  offsetXmm: 0,
  offsetYmm: 0,
  logFolder: null
}

function errorFields(input: unknown): string[] {
  const result = normalisePcSettings(input)
  return result.ok ? [] : result.errors.map((error) => error.field)
}

describe('snapToPrinterDots', () => {
  it('rounds to the nearest whole printer dot (25.4 / 203 mm)', () => {
    expect(snapToPrinterDots(0)).toBe(0)
    expect(snapToPrinterDots(DOT_MM * 0.4)).toBe(0)
    expect(snapToPrinterDots(DOT_MM * 0.6)).toBeCloseTo(DOT_MM, 12)
    expect(snapToPrinterDots(0.3)).toBeCloseTo(2 * DOT_MM, 12)
    expect(snapToPrinterDots(-1)).toBeCloseTo(-8 * DOT_MM, 12)
  })

  it('is idempotent and never returns -0', () => {
    const once = snapToPrinterDots(0.77)
    expect(snapToPrinterDots(once)).toBe(once)
    expect(Object.is(snapToPrinterDots(-0.01), -0)).toBe(false)
  })

  it('reports an offset in whole dots', () => {
    expect(offsetInDots(snapToPrinterDots(0.3))).toBe(2)
    expect(offsetInDots(snapToPrinterDots(-1))).toBe(-8)
  })
})

describe('normalisePcSettings', () => {
  it('defaults to a 34.4 × 25 mm label, no offsets and the default log folder', () => {
    expect(DEFAULT_PC_SETTINGS).toEqual({
      printerName: '',
      labelSize: DEFAULT_LABEL_SIZE,
      offsetXmm: 0,
      offsetYmm: 0,
      logFolder: null
    })
  })

  it('accepts valid settings unchanged', () => {
    expect(normalisePcSettings(valid)).toEqual({ ok: true, settings: valid })
  })

  it('snaps offsets to whole printer dots, so modules stay exactly 4 dots', () => {
    const result = normalisePcSettings({ ...valid, offsetXmm: 0.3, offsetYmm: -0.5 })
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(result.settings.offsetXmm).toBeCloseTo(2 * DOT_MM, 12)
    expect(result.settings.offsetYmm).toBeCloseTo(-4 * DOT_MM, 12)
  })

  it('rounds label sizes to 0.01 mm and trims the printer name', () => {
    const result = normalisePcSettings({ ...valid, printerName: '  ZDesigner GX420t ', labelSize: { widthMm: 34.40000001, heightMm: 25.004 } })
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(result.settings.printerName).toBe('ZDesigner GX420t')
    expect(result.settings.labelSize).toEqual({ widthMm: 34.4, heightMm: 25 })
  })

  it('keeps a chosen log folder', () => {
    const result = normalisePcSettings({ ...valid, logFolder: 'S:\\Pharmacy\\Label logs' })
    expect(result.ok && result.settings.logFolder).toBe('S:\\Pharmacy\\Label logs')
  })

  it('requires a printer', () => {
    expect(errorFields({ ...valid, printerName: '' })).toEqual(['printerName'])
    expect(errorFields({ ...valid, printerName: '   ' })).toEqual(['printerName'])
  })

  it(`refuses a label size outside ${LABEL_SIZE_LIMITS_MM.min}–${LABEL_SIZE_LIMITS_MM.max} mm`, () => {
    expect(errorFields({ ...valid, labelSize: { widthMm: LABEL_SIZE_LIMITS_MM.min - 1, heightMm: 25 } })).toEqual(['widthMm'])
    expect(errorFields({ ...valid, labelSize: { widthMm: 34.4, heightMm: LABEL_SIZE_LIMITS_MM.max + 1 } })).toEqual(['heightMm'])
    expect(errorFields({ ...valid, labelSize: { widthMm: Number.NaN, heightMm: Number.POSITIVE_INFINITY } })).toEqual(['widthMm', 'heightMm'])
  })

  it(`refuses an offset beyond ±${MAX_OFFSET_MM} mm`, () => {
    expect(errorFields({ ...valid, offsetXmm: MAX_OFFSET_MM + 0.5 })).toEqual(['offsetXmm'])
    expect(errorFields({ ...valid, offsetYmm: -MAX_OFFSET_MM - 0.5 })).toEqual(['offsetYmm'])
  })

  it('refuses anything that is not settings', () => {
    expect(errorFields(null)).toEqual(['printerName', 'widthMm', 'heightMm', 'offsetXmm', 'offsetYmm', 'logFolder'])
    expect(errorFields({ ...valid, offsetXmm: '1' })).toEqual(['offsetXmm'])
    expect(errorFields({ ...valid, logFolder: 42 })).toEqual(['logFolder'])
    expect(errorFields({ ...valid, logFolder: '' })).toEqual(['logFolder'])
  })
})
