import { describe, expect, it } from 'vitest'
import { topupContent, type TopupEntry } from '../core/topup'
import { dotMm } from './dataMatrix'
import { TOPUP_TAPE_SIZE } from './printSettings'
import { printableBandMm } from './tapeSize'
import { buildTopupLabel, renderTopupLabelSvg, type TopupLabel, type TopupLabelInput } from './topupLabel'

/** The longest entry in the built-in Topup Database: 172 characters of content. */
const DIPH32: TopupEntry = {
  itemCode: 'DIPH32',
  displayName: 'DIPH/TET/PER(ADS)/POLIO(INACT) (BOOSTRIX POLIO) BOOSTER',
  salt: 'ACELLULAR PERTUSSIS',
  formCode: 'VAC'
}
/** A typical entry: 107 characters. */
const FLU01: TopupEntry = { itemCode: '5FLU01', displayName: '5FLUCYTOSINE', salt: '', formCode: 'TAB' }

function input(entry: TopupEntry, symbology: TopupLabelInput['symbology'], copies = 1): TopupLabelInput {
  return { itemCode: entry.itemCode, content: topupContent(entry), symbology, copies }
}

function labelOf(entry: TopupEntry, symbology: TopupLabelInput['symbology'], dpi: 203 | 300 | 360): TopupLabel {
  const built = buildTopupLabel(input(entry, symbology), dpi)
  if (!built.ok) throw new Error(built.message)
  return built.label
}

/** 8 pt bold: Arial capital height 0.716 em, descent 0.212 em. */
const TEXT_HEIGHT_MM = 8 * (25.4 / 72) * (0.716 + 0.212)
const band = printableBandMm(24)

describe('buildTopupLabel: the code', () => {
  it('holds exactly the content, as the smallest QR (ECC L) or square DataMatrix that holds it', () => {
    expect(topupContent(DIPH32)).toHaveLength(172)
    const qr = labelOf(DIPH32, 'qr', 360)
    expect(qr).toMatchObject({ itemCode: 'DIPH32', symbology: 'qr', content: topupContent(DIPH32) })
    expect([qr.symbol.columns, qr.symbol.rows]).toEqual([49, 49])
    const dm = labelOf(DIPH32, 'datamatrix', 360)
    expect([dm.symbol.columns, dm.symbol.rows]).toEqual([48, 48])
  })

  it('fits the longest entry on 24 mm tape at 360 dpi in both code types, at the largest whole-dot module that fits', () => {
    // QR 49 + 2 × 4 quiet modules: 5 dots (0.353 mm) needs 20.1 mm + the text line 2.6 mm, over the 22.6 mm band.
    expect(labelOf(DIPH32, 'qr', 360)).toMatchObject({ moduleDots: 4 })
    // DataMatrix 48 + 2 × 1: 6 dots needs 21.2 + 2.6 mm; 5 dots 17.6 + 2.6 mm fits.
    expect(labelOf(DIPH32, 'datamatrix', 360)).toMatchObject({ moduleDots: 5 })
    expect(labelOf(DIPH32, 'qr', 360).moduleMm).toBeCloseTo(4 * dotMm(360), 9)
  })

  it('never uses a module over 0.5 mm, even where a larger one would fit', () => {
    // 4 dots at 203 dpi is 0.5005 mm.
    const short = buildTopupLabel({ itemCode: 'A00001', content: 'A', symbology: 'datamatrix', copies: 1 }, 203)
    expect(short).toMatchObject({ ok: true, label: { moduleDots: 3 } })
    expect(buildTopupLabel({ itemCode: 'A00001', content: 'A', symbology: 'qr', copies: 1 }, 360)).toMatchObject({ ok: true, label: { moduleDots: 7 } })
    expect(buildTopupLabel({ itemCode: 'A00001', content: 'A', symbology: 'qr', copies: 1 }, 300)).toMatchObject({ ok: true, label: { moduleDots: 5 } })
  })

  it('sizes a typical entry larger than the longest', () => {
    // QR 41 + 8 modules at 6 dots: 20.7 + 2.6 mm is over the band; at 5 dots 17.3 + 2.6 mm fits.
    expect(labelOf(FLU01, 'qr', 360)).toMatchObject({ moduleDots: 5, symbol: { columns: 41 } })
    // DataMatrix 40 + 2 modules at 6 dots: 17.8 + 2.6 mm fits.
    expect(labelOf(FLU01, 'datamatrix', 360)).toMatchObject({ moduleDots: 6, symbol: { columns: 40 } })
  })

  it('is refused when it fits only with modules under 0.25 mm', () => {
    const long = { itemCode: 'LONG01', content: 'X'.repeat(1200), symbology: 'qr', copies: 1 } as const
    expect(buildTopupLabel(long, 360)).toEqual({
      ok: false,
      message: 'The code is too big for 24 mm tape: it fits only with modules under 0.25 mm.'
    })
  })

  it('is refused for content other than printable ASCII, which the top-up system would read differently', () => {
    expect(buildTopupLabel({ itemCode: 'A00001', content: '<a>µg</a>', symbology: 'qr', copies: 1 }, 360)).toEqual({
      ok: false,
      message: 'The code content holds a character other than plain ASCII, so it is not printed.'
    })
  })
})

describe('buildTopupLabel: the layout', () => {
  for (const [symbology, dpi] of [
    ['qr', 360],
    ['datamatrix', 360],
    ['qr', 203],
    ['datamatrix', 300]
  ] as const) {
    it(`keeps the ${symbology} code, its quiet zone and the Item Code inside the band and the 26 mm length at ${dpi} dpi, the block centred`, () => {
      const label = labelOf(DIPH32, symbology, dpi)
      const { symbol, line } = label
      const quiet = (symbology === 'qr' ? 4 : 1) * label.moduleMm
      expect(label.size).toEqual({ widthMm: 26, heightMm: 24 })
      expect(symbol.yMm - quiet).toBeGreaterThanOrEqual(band.topMm - 1e-9)
      expect(symbol.xMm - quiet).toBeGreaterThanOrEqual(0)
      expect(symbol.xMm + symbol.widthMm + quiet).toBeLessThanOrEqual(26 + 1e-9)
      // The Item Code under the code's quiet zone, inside the band.
      expect(line.topMm).toBeGreaterThanOrEqual(symbol.yMm + symbol.heightMm + quiet - 1e-9)
      expect(line.bottomMm).toBeLessThanOrEqual(band.bottomMm + 1e-9)
      // Centred: along the label to a dot, and the block across the tape to a dot.
      expect(Math.abs(symbol.xMm + symbol.widthMm / 2 - 13)).toBeLessThanOrEqual(dotMm(dpi))
      const blockTop = symbol.yMm - quiet
      const blockBottom = symbol.yMm + symbol.heightMm + quiet + TEXT_HEIGHT_MM
      expect(Math.abs((blockTop + blockBottom) / 2 - 12)).toBeLessThanOrEqual(dotMm(dpi))
      // Whole printer dots.
      expect(Math.abs(symbol.xMm / dotMm(dpi) - Math.round(symbol.xMm / dotMm(dpi)))).toBeLessThan(1e-6)
      expect(Math.abs(symbol.yMm / dotMm(dpi) - Math.round(symbol.yMm / dotMm(dpi)))).toBeLessThan(1e-6)
    })
  }

  it('prints the Item Code in 8 pt bold, centred under the code', () => {
    const { line, symbol } = labelOf(DIPH32, 'qr', 360)
    expect(line.runs).toEqual([{ text: 'DIPH32', fontSizePt: 8, bold: true, gapBeforeMm: 0 }])
    expect(line.scaleX).toBe(1)
    expect(line.xMm + line.widthMm / 2).toBeCloseTo(symbol.xMm + symbol.widthMm / 2, 1)
  })

  it('is the label of the built-in Tape Size 24 mm tape × 26 mm', () => {
    expect(TOPUP_TAPE_SIZE).toMatchObject({ name: '24 mm tape × 26 mm', kind: 'tape', widthMm: 26, heightMm: 24 })
  })
})

describe('buildTopupLabel: copies', () => {
  it('takes 1–99', () => {
    expect(buildTopupLabel(input(FLU01, 'qr', 99), 360)).toMatchObject({ ok: true, label: { copies: 99 } })
    for (const copies of [0, 100, 1.5, Number.NaN]) {
      expect(buildTopupLabel(input(FLU01, 'qr', copies), 360)).toEqual({ ok: false, message: 'Copies must be a whole number from 1 to 99.' })
    }
  })
})

describe('renderTopupLabelSvg', () => {
  it('draws the 26 × 24 mm label with the code and the Item Code', () => {
    const svg = renderTopupLabelSvg(labelOf(DIPH32, 'qr', 360))
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="26mm" height="24mm" viewBox="0 0 26 24"/)
    expect(svg).toContain('font-weight="bold">DIPH32</tspan>')
    expect(svg).toContain('shape-rendering="crispEdges"')
  })
})
