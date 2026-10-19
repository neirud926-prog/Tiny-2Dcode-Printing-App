import { describe, expect, it } from 'vitest'
import { itemCodeFromScan, NOT_RECOGNISED_MESSAGE } from './scanInput'

const NOT_RECOGNISED = { ok: false, message: NOT_RECOGNISED_MESSAGE }

describe('itemCodeFromScan', () => {
  describe('ticket examples', () => {
    it('takes PARA01 from the shelf QR PARA01_1C5A_BPh!oUCUb0SGI/13ZaR', () => {
      expect(itemCodeFromScan('PARA01_1C5A_BPh!oUCUb0SGI/13ZaR')).toEqual({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
    })

    it('takes PIOG02 from the in-patient dispensing-bag label 2607PIOG02A1B', () => {
      expect(itemCodeFromScan('2607PIOG02A1B')).toEqual({ ok: true, itemCode: 'PIOG02', source: 'bag-label-ip' })
    })

    it('keeps AIR 01 as typed, inner space and all', () => {
      expect(itemCodeFromScan('AIR 01')).toEqual({ ok: true, itemCode: 'AIR 01', source: 'typed' })
    })
  })

  describe('a plain 6-character Item Code (typed, or an out-patient dispensing-bag label)', () => {
    it.each(['PARA01', 'K Y 02', 'SYR-05', 'S&W 01', 'VIT.B1', '9-AB12', '000000', '......'])('keeps %j', (itemCode) => {
      expect(itemCodeFromScan(itemCode)).toEqual({ ok: true, itemCode, source: 'typed' })
    })

    it('upper-cases a–z', () => {
      expect(itemCodeFromScan('para01')).toEqual({ ok: true, itemCode: 'PARA01', source: 'typed' })
      expect(itemCodeFromScan('Air 01')).toEqual({ ok: true, itemCode: 'AIR 01', source: 'typed' })
    })

    it.each(['PARA#1', 'PARA_1', 'PÄRA01', 'ＰARA01', 'ıARA01', 'ſARA01'])('refuses %j, which has a character outside the 40', (raw) => {
      expect(itemCodeFromScan(raw)).toEqual(NOT_RECOGNISED)
    })
  })

  describe('a shelf QR', () => {
    it('takes the Item Code from PMH’s plain ITEMCODE_BIN', () => {
      expect(itemCodeFromScan('PARA01_1C5A')).toEqual({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
    })

    it('keeps a space inside the Item Code', () => {
      expect(itemCodeFromScan('AIR 01_2B3C_BPh!oUCUb0SGI/13ZaR')).toEqual({ ok: true, itemCode: 'AIR 01', source: 'shelf-qr' })
      expect(itemCodeFromScan('K Y 02_3D')).toEqual({ ok: true, itemCode: 'K Y 02', source: 'shelf-qr' })
    })

    it('upper-cases the Item Code; the BIN and hash are not used', () => {
      expect(itemCodeFromScan('para01_1c5a_bph!oucub0sgi/13zar')).toEqual({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
    })

    it('accepts any 4 characters as the BIN of the prefixed form, as BCS does', () => {
      expect(itemCodeFromScan('PARA01_A 9-_BPh!oUCUb0SGI/13ZaR')).toEqual({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
    })

    it('accepts a plain ITEMCODE_BIN of 9 to 13 characters, any BIN characters but an underscore', () => {
      expect(itemCodeFromScan('PARA01_1C')).toMatchObject({ ok: true, itemCode: 'PARA01' })
      expect(itemCodeFromScan('PARA01_1C5A12')).toMatchObject({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
      // Real bins: PMH's `AA 9` has a space; NLTH mobile shelves look like `M11-R1`.
      expect(itemCodeFromScan('PARA01_AA 9')).toMatchObject({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
      expect(itemCodeFromScan('PARA01_M11-R1')).toMatchObject({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
      expect(itemCodeFromScan('PARA01_1C/5')).toMatchObject({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
    })

    it.each([
      ['a 1-character BIN', 'PARA01_1'],
      ['a 7-character BIN', 'PARA01_1C5A123'],
      ['an empty BIN', 'PARA01__hash'],
      ['an empty hash', 'PARA01_1C5A_'],
      ['a hash not in the `B…aR` shape', 'PARA01_1C5A_ab_cd_ef'],
      ['a 3-character BIN before the hash', 'PARA01_1C5_BPh!oUCUb0SGI/13ZaR'],
      ['a 5-character BIN before the hash', 'PARA01_1C5AB_BPh!oUCUb0SGI/13ZaR'],
      ['nothing after the underscore', 'PARA01_']
    ])('refuses %s', (_, raw) => {
      expect(itemCodeFromScan(raw)).toEqual(NOT_RECOGNISED)
    })

    it.each([
      ['an invalid character', 'PAR#01_1C5A_BPh!oUCUb0SGI/13ZaR'],
      ['an invalid character (plain form)', 'PARA!1_1C5A'],
      ['the underscore one place early', 'PARA0_1C5A_BPh!oUCUb0SGI/13ZaR'],
      ['the underscore one place late', 'PARA011_1C5A_BPh!oUCUb0SGI/13ZaR']
    ])('refuses a shelf QR whose first 6 characters are not an Item Code: %s', (_, raw) => {
      expect(itemCodeFromScan(raw)).toEqual(NOT_RECOGNISED)
    })
  })

  describe('an in-patient dispensing-bag label (4 characters, the Item Code, 3 characters)', () => {
    it('keeps a space inside the Item Code', () => {
      expect(itemCodeFromScan('2607AIR 01A1B')).toEqual({ ok: true, itemCode: 'AIR 01', source: 'bag-label-ip' })
    })

    it('upper-cases a–z', () => {
      expect(itemCodeFromScan('2607piog02a1b')).toEqual({ ok: true, itemCode: 'PIOG02', source: 'bag-label-ip' })
    })

    it.each([
      ['an invalid character in the Item Code', '2607PI#G02A1B'],
      ['a space in the 4 leading characters', '260 PIOG02A1B'],
      ['a symbol in the 3 trailing characters', '2607PIOG02A-B'],
      // An EAN-13 on the same pack is 13 digits; no Item Code is all digits, so it is not a bag label.
      ['13 digits (a manufacturer EAN-13)', '4891234567890']
    ])('refuses 13 characters with %s', (_, raw) => {
      expect(itemCodeFromScan(raw)).toEqual(NOT_RECOGNISED)
    })
  })

  describe('what a wedge scanner adds, and surrounding whitespace', () => {
    it.each(['\r', '\n', '\r\n', '\t', '\r\n\r\n'])('drops a trailing %j', (suffix) => {
      expect(itemCodeFromScan(`PARA01${suffix}`)).toEqual({ ok: true, itemCode: 'PARA01', source: 'typed' })
      expect(itemCodeFromScan(`2607PIOG02A1B${suffix}`)).toEqual({ ok: true, itemCode: 'PIOG02', source: 'bag-label-ip' })
      expect(itemCodeFromScan(`PARA01_1C5A_BPh!oUCUb0SGI/13ZaR${suffix}`)).toEqual({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
    })

    it('drops a leading Tab, CR or LF', () => {
      expect(itemCodeFromScan('\tAIR 01\r\n')).toEqual({ ok: true, itemCode: 'AIR 01', source: 'typed' })
    })

    it('trims spaces around a code that does not fit a pattern with them', () => {
      expect(itemCodeFromScan('PARA01 ')).toEqual({ ok: true, itemCode: 'PARA01', source: 'typed' })
      expect(itemCodeFromScan('  AIR 01  ')).toEqual({ ok: true, itemCode: 'AIR 01', source: 'typed' })
      expect(itemCodeFromScan(' AIR 01\r\n')).toEqual({ ok: true, itemCode: 'AIR 01', source: 'typed' })
      expect(itemCodeFromScan('PARA01 ')).toEqual({ ok: true, itemCode: 'PARA01', source: 'typed' })
      expect(itemCodeFromScan(' 2607PIOG02A1B ')).toEqual({ ok: true, itemCode: 'PIOG02', source: 'bag-label-ip' })
      expect(itemCodeFromScan(' PARA01_1C5A ')).toEqual({ ok: true, itemCode: 'PARA01', source: 'shelf-qr' })
    })

    it('keeps a space at either end of exactly 6 characters: a space is an Item Code character', () => {
      // Ambiguous ("PARA0" plus a stray space, or an Item Code ending in a space), so nothing is
      // trimmed and the Item List lookup decides; it is never shortened to a 5-character guess.
      expect(itemCodeFromScan('PARA0 ')).toEqual({ ok: true, itemCode: 'PARA0 ', source: 'typed' })
      expect(itemCodeFromScan(' ARA01')).toEqual({ ok: true, itemCode: ' ARA01', source: 'typed' })
    })

    it('never takes an Item Code from a bag label shifted by a stray space', () => {
      // As-is the 4 leading characters hold a space; trimmed it is 12 characters. Taking characters
      // 5–10 would give "7PIOG0", a wrong Item Code.
      expect(itemCodeFromScan(' 2607PIOG02A1')).toEqual(NOT_RECOGNISED)
    })

    it('never removes or squeezes spaces inside', () => {
      expect(itemCodeFromScan('AIR  01')).toEqual(NOT_RECOGNISED)
      expect(itemCodeFromScan('PARA 01')).toEqual(NOT_RECOGNISED)
    })
  })

  describe('anything else is refused, never guessed', () => {
    it.each([
      ['empty', ''],
      ['only spaces', '   '],
      ['6 spaces', '      '],
      ['only a scanner suffix', '\r\n'],
      ['5 characters', 'PARA0'],
      ['7 characters', 'PARA011'],
      ['12 characters', '2607PIOG02A1'],
      ['14 characters', '2607PIOG02A1BC'],
      ['words', 'paracetamol 500mg'],
      ['a GS1 element string', '010042587344001017271231102512172-1'],
      ['a GS1 element string with a group separator', '0109501101530003172712311015863A\u001d21ABC'],
      ['a URL', 'https://example.com/PARA01_1C5A'],
      ['a CR inside', 'PAR\rA01']
    ])('refuses %s', (_, raw) => {
      expect(itemCodeFromScan(raw)).toEqual(NOT_RECOGNISED)
    })

    it('says what it accepts', () => {
      expect(NOT_RECOGNISED_MESSAGE).toBe('Not an Item Code, shelf label or dispensing-bag label.')
    })
  })
})
