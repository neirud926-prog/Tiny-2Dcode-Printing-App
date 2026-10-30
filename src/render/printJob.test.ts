import { describe, expect, it } from 'vitest'
import { buildLabel, type LabelRequest } from '../core/label'
import { DOT_MM } from './dataMatrix'
import { renderLabelSvg } from './labelSvg'
import { LAYOUT_1 } from '../core/template'
import { buildCustomLabel, renderCustomLabelSvg } from './customLabel'
import { buildCustomLabelPrintJob, buildLabelPrintJob, htmlDataUrl, sampleLabelRequest } from './printJob'
import { SMALL_LABEL, type PrintSettings } from './printSettings'

const today = '2026-10-19'

function labelFor(overrides: Partial<LabelRequest> = {}) {
  const result = buildLabel(
    { itemCode: 'PARA18', packVolumeDigit: 2, expiry: '31122027', lot: '2512172-1', copies: 3, ...overrides },
    { today }
  )
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.label
}

const settings: PrintSettings = {
  printerName: 'ZDesigner GX420t',
  printerResolution: 203,
  labelSize: { widthMm: 34.4, heightMm: 25 },
  offsetXmm: 2 * DOT_MM,
  offsetYmm: -3 * DOT_MM
}

describe('buildLabelPrintJob', () => {
  it('prints silently to the configured printer, page size and copies', () => {
    const { options } = buildLabelPrintJob(labelFor(), settings)
    expect(options).toEqual({
      silent: true,
      deviceName: 'ZDesigner GX420t',
      printBackground: true,
      margins: { marginType: 'none' },
      landscape: false,
      // Electron takes a custom page size in microns.
      pageSize: { width: 34_400, height: 25_000 },
      copies: 3,
      scaleFactor: 100
    })
  })

  it('follows a smaller label roll from settings', () => {
    const { options, html } = buildLabelPrintJob(labelFor({ copies: 1 }), { ...settings, labelSize: { widthMm: 30, heightMm: 20.5 } })
    expect(options.pageSize).toEqual({ width: 30_000, height: 20_500 })
    expect(options.copies).toBe(1)
    expect(html).toContain('@page{size:30mm 20.5mm;margin:0}')
  })

  it('holds the label SVG at the configured size on a margin-less page', () => {
    const label = labelFor()
    const { html } = buildLabelPrintJob(label, settings)
    expect(html).toContain('@page{size:34.4mm 25mm;margin:0}')
    expect(html).toMatch(/html,body\{margin:0;/)
    expect(html).toContain(renderLabelSvg(label, settings.labelSize))
  })

  it('applies the offsets as a translate, in mm', () => {
    const { html } = buildLabelPrintJob(labelFor(), settings)
    expect(html).toContain(`transform:translate(${(2 * DOT_MM).toFixed(4)}mm,${(-3 * DOT_MM).toFixed(4)}mm)`)
  })

  it('locks the page down: no scripts, nothing loaded from anywhere', () => {
    const { html } = buildLabelPrintJob(labelFor(), settings)
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`)
    expect(html).not.toMatch(/<script/i)
  })
})

describe('buildCustomLabelPrintJob', () => {
  it('prints the Custom Label SVG on its size, with the offsets and copies, locked down like a GTIN Label', () => {
    const built = buildCustomLabel(LAYOUT_1, SMALL_LABEL, { symbology: 'qr', codeValue: 'Bin #4', texts: ['Bin #4'], copies: 7 }, 203)
    if (!built.ok) throw new Error(JSON.stringify(built.errors))
    const { html, options } = buildCustomLabelPrintJob(built.label, settings)
    expect(options).toMatchObject({ silent: true, deviceName: 'ZDesigner GX420t', pageSize: { width: 34_400, height: 25_000 }, copies: 7 })
    expect(html).toContain('@page{size:34.4mm 25mm;margin:0}')
    expect(html).toContain(`transform:translate(${(2 * DOT_MM).toFixed(4)}mm,${(-3 * DOT_MM).toFixed(4)}mm)`)
    expect(html).toContain(renderCustomLabelSvg(built.label))
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`)
    expect(html).not.toMatch(/<script/i)
  })
})

describe('htmlDataUrl', () => {
  it('encodes a page as a UTF-8 data URL', () => {
    const html = '<p>#1 & 100% (test)</p>'
    const url = htmlDataUrl(html)
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))).toBe(html)
    expect(url).not.toContain('#')
  })
})

describe('sampleLabelRequest', () => {
  it('is a valid one-copy TEST01 label with Lot TEST, expiring a year ahead', () => {
    const request = sampleLabelRequest(today)
    expect(request).toEqual({ itemCode: 'TEST01', packVolumeDigit: 0, expiry: '01102027', lot: 'TEST', copies: 1 })
    expect(buildLabel(request, { today })).toMatchObject({ ok: true, warnings: [] })
  })

  it('is valid on any day, including 29 February', () => {
    for (const day of ['2028-02-29', '2026-12-31', '2027-01-01']) {
      expect(buildLabel(sampleLabelRequest(day), { today: day }).ok).toBe(true)
    }
  })
})
