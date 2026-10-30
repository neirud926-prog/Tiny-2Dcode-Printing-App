import { describe, expect, it } from 'vitest'
import { buildLabel, type LabelRequest } from '../core/label'
import { DOT_MM } from './dataMatrix'
import { renderLabelSvg } from './labelSvg'
import { LAYOUT_1 } from '../core/template'
import { buildCustomLabel, renderCustomLabelSvg } from './customLabel'
import { buildCustomLabelPrintJob, buildLabelPrintJob, buildTapeTestPrintJob, htmlDataUrl, sampleLabelRequest } from './printJob'
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

describe('a print job on tape', () => {
  // 24 mm tape × 40 mm: laid out 40 mm long (x) × 24 mm across the tape (y).
  const onTape: PrintSettings = { ...settings, labelSize: { widthMm: 40, heightMm: 24 }, onTape: true }

  it("uses the driver's paper: no page size, the rest as for a die-cut label", () => {
    const { options } = buildLabelPrintJob(labelFor(), onTape)
    expect(options).toEqual({
      silent: true,
      deviceName: 'ZDesigner GX420t',
      printBackground: true,
      margins: { marginType: 'none' },
      landscape: false,
      pageSize: null,
      copies: 3,
      scaleFactor: 100
    })
  })

  it('turns the label a quarter turn on a portrait page as wide as the tape, offsets still along the label', () => {
    const { html } = buildLabelPrintJob(labelFor(), onTape)
    expect(html).toContain('@page{margin:0}')
    expect(html).not.toContain('size:')
    expect(html).toContain('html,body{margin:0;padding:0;width:24mm;height:40mm;')
    expect(html).toContain(
      `.label{width:40mm;height:24mm;transform-origin:0 0;transform:translate(24mm,0) rotate(90deg) translate(${(2 * DOT_MM).toFixed(4)}mm,${(-3 * DOT_MM).toFixed(4)}mm)}`
    )
  })
})

describe('buildTapeTestPrintJob', () => {
  it('prints the outline, the printable band edges and the size name, one copy, on the driver\'s paper', () => {
    const tape = { id: 't', name: '24 mm tape × 40 mm', kind: 'tape', widthMm: 40, heightMm: 24 } as const
    const { html, options } = buildTapeTestPrintJob(tape, { ...settings, labelSize: { widthMm: 40, heightMm: 24 }, onTape: true })
    expect(options).toMatchObject({ pageSize: null, copies: 1 })
    expect(html).toContain('rotate(90deg)')
    expect(html).toContain('<rect x="0.1" y="0.1" width="39.8" height="23.8"')
    // 320 dots at 360 dpi = 22.5778 mm, centred on 24 mm tape.
    expect(html).toContain('<line x1="0" y1="0.7111" x2="40" y2="0.7111"')
    expect(html).toContain('<line x1="0" y1="23.2889" x2="40" y2="23.2889"')
    expect(html).toContain('>24 mm tape × 40 mm</text>')
  })

  it('keeps the band on 3.5 mm tape: 48 dots', () => {
    const tape = { id: 't', name: 'Tiny & thin', kind: 'tape', widthMm: 20, heightMm: 3.5 } as const
    const { html } = buildTapeTestPrintJob(tape, { ...settings, labelSize: { widthMm: 20, heightMm: 3.5 }, onTape: true })
    expect(html).toContain('y1="0.0567"')
    expect(html).toContain('y1="3.4433"')
    expect(html).toContain('>Tiny &amp; thin</text>')
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
