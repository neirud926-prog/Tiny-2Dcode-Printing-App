import { describe, expect, it } from 'vitest'
import { DOT_MM } from './dataMatrix'
import {
  DEFAULT_PC_SETTINGS,
  LABEL_SIZE_LIMITS_MM,
  MAX_OFFSET_MM,
  normaliseLabelSize,
  normalisePcSettings,
  offsetInDots,
  offsetsFor,
  printSettingsFor,
  SMALL_LABEL,
  snapToPrinterDots,
  type PcSettings
} from './printSettings'

const valid: PcSettings = {
  printerName: 'ZDesigner GX420t',
  labelSizeId: SMALL_LABEL.id,
  offsets: { [SMALL_LABEL.id]: { offsetXmm: 0, offsetYmm: 0 } },
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
  const small = SMALL_LABEL.id
  const offsetsOf = (offsetXmm: unknown, offsetYmm: unknown) => ({ [small]: { offsetXmm, offsetYmm } })

  it('defaults to the Small Label, no offsets and the default log folder', () => {
    expect(DEFAULT_PC_SETTINGS).toEqual({ printerName: '', labelSizeId: 'small-label', offsets: {}, logFolder: null })
    expect(offsetsFor(DEFAULT_PC_SETTINGS, small)).toEqual({ offsetXmm: 0, offsetYmm: 0 })
  })

  it('accepts valid settings unchanged', () => {
    expect(normalisePcSettings(valid)).toEqual({ ok: true, settings: valid })
  })

  it('snaps offsets to whole printer dots, so modules stay exactly 4 dots', () => {
    const result = normalisePcSettings({ ...valid, offsets: offsetsOf(0.3, -0.5) })
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(result.settings.offsets[small].offsetXmm).toBeCloseTo(2 * DOT_MM, 12)
    expect(result.settings.offsets[small].offsetYmm).toBeCloseTo(-4 * DOT_MM, 12)
  })

  it('trims the printer name', () => {
    const result = normalisePcSettings({ ...valid, printerName: '  ZDesigner GX420t ' })
    expect(result.ok && result.settings.printerName).toBe('ZDesigner GX420t')
  })

  it('keeps a chosen log folder', () => {
    const result = normalisePcSettings({ ...valid, logFolder: 'S:\\Pharmacy\\Label logs' })
    expect(result.ok && result.settings.logFolder).toBe('S:\\Pharmacy\\Label logs')
  })

  it('requires a printer and a loaded Label Size', () => {
    expect(errorFields({ ...valid, printerName: '' })).toEqual(['printerName'])
    expect(errorFields({ ...valid, printerName: '   ' })).toEqual(['printerName'])
    expect(errorFields({ ...valid, labelSizeId: '' })).toEqual(['labelSizeId'])
  })

  it(`refuses an offset beyond ±${MAX_OFFSET_MM} mm, for any size`, () => {
    expect(errorFields({ ...valid, offsets: offsetsOf(MAX_OFFSET_MM + 0.5, 0) })).toEqual(['offsetXmm'])
    expect(errorFields({ ...valid, offsets: { ...valid.offsets, other: { offsetXmm: 0, offsetYmm: -MAX_OFFSET_MM - 0.5 } } })).toEqual(['offsetYmm'])
  })

  it('refuses anything that is not settings', () => {
    expect(errorFields(null)).toEqual(['printerName', 'labelSizeId', 'offsetXmm', 'logFolder'])
    expect(errorFields({ ...valid, offsets: offsetsOf('1', 0) })).toEqual(['offsetXmm'])
    expect(errorFields({ ...valid, logFolder: 42 })).toEqual(['logFolder'])
    expect(errorFields({ ...valid, logFolder: '' })).toEqual(['logFolder'])
  })
})

describe('normaliseLabelSize', () => {
  it('trims the name and rounds the size to 0.01 mm', () => {
    expect(normaliseLabelSize({ name: ' Shelf ', widthMm: 50.004, heightMm: 30 })).toEqual({ ok: true, size: { name: 'Shelf', kind: 'label', widthMm: 50, heightMm: 30 } })
  })

  it(`refuses a size outside ${LABEL_SIZE_LIMITS_MM.min}–${LABEL_SIZE_LIMITS_MM.max} mm and a missing or long name`, () => {
    const fields = (input: unknown) => {
      const result = normaliseLabelSize(input)
      return result.ok ? [] : result.errors.map((error) => error.field)
    }
    expect(fields({ name: 'A', widthMm: LABEL_SIZE_LIMITS_MM.min - 1, heightMm: 25 })).toEqual(['widthMm'])
    expect(fields({ name: 'A', widthMm: 34.4, heightMm: LABEL_SIZE_LIMITS_MM.max + 1 })).toEqual(['heightMm'])
    expect(fields({ name: 'A', widthMm: Number.NaN, heightMm: Number.POSITIVE_INFINITY })).toEqual(['widthMm', 'heightMm'])
    expect(fields({ name: 'x'.repeat(41), widthMm: 50, heightMm: 30 })).toEqual(['name'])
    expect(fields(null)).toEqual(['name', 'widthMm', 'heightMm'])
  })
})

describe('printSettingsFor', () => {
  it('gives a print job the size and that size\'s offsets', () => {
    const shelf = { id: 'shelf', name: 'Shelf', kind: 'label', widthMm: 50, heightMm: 30 } as const
    const settings = { ...valid, offsets: { ...valid.offsets, shelf: { offsetXmm: DOT_MM, offsetYmm: 0 } } }
    expect(printSettingsFor(settings, shelf)).toEqual({ printerName: valid.printerName, labelSize: { widthMm: 50, heightMm: 30 }, offsetXmm: DOT_MM, offsetYmm: 0 })
    expect(printSettingsFor(settings, SMALL_LABEL)).toEqual({ printerName: valid.printerName, labelSize: { widthMm: 34.4, heightMm: 25 }, offsetXmm: 0, offsetYmm: 0 })
  })
})
