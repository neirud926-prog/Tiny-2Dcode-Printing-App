import { describe, expect, it } from 'vitest'
import { decodeReportText } from './reportText'

describe('decodeReportText', () => {
  it('reads valid UTF-8, without its BOM', () => {
    expect(decodeReportText(Buffer.from('Report Date: 19/10/2026\r\nµG', 'utf8'))).toBe('Report Date: 19/10/2026\r\nµG')
    expect(decodeReportText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Crème', 'utf8')]))).toBe('Crème')
  })

  it('reads anything else as Windows-1252', () => {
    expect(decodeReportText(Buffer.from([0x31, 0x30, 0x30, 0x30, 0xb5, 0x47]))).toBe('1000µG')
    expect(decodeReportText(Buffer.from([0x80, 0x20, 0x93, 0x41, 0x94, 0x20, 0x96, 0x20, 0xe8]))).toBe('€ “A” – è')
    // Bytes Windows-1252 leaves undefined read as their latin1 code points.
    expect(decodeReportText(Buffer.from([0x81, 0x8d, 0x8f, 0x90, 0x9d]))).toBe('\u0081\u008d\u008f\u0090\u009d')
  })

  it('reads a UTF-8 BOM followed by bytes that are not UTF-8 as Windows-1252, without the BOM', () => {
    expect(decodeReportText(Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0xb5]))).toBe('Aµ')
  })

  it('reads UTF-16 with a byte order mark', () => {
    expect(decodeReportText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Lot µ', 'utf16le')]))).toBe('Lot µ')
  })

  it('reads an empty file as empty text', () => {
    expect(decodeReportText(Buffer.alloc(0))).toBe('')
  })
})
