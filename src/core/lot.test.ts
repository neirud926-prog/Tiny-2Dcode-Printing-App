import { describe, expect, it } from 'vitest'
import { LOT_MAX_LENGTH, normaliseLot } from './lot'

describe('normaliseLot', () => {
  it('upper-cases a–z: 15863a → 15863A', () => {
    expect(normaliseLot('15863a')).toEqual({ ok: true, lot: '15863A' })
    expect(normaliseLot('vrty-t002')).toEqual({ ok: true, lot: 'VRTY-T002' })
  })

  it('trims spaces around the Lot', () => {
    expect(normaliseLot('  2512172-1 ')).toEqual({ ok: true, lot: '2512172-1' })
  })

  it.each(['MIPL/A4/UII/91', '(B)A52921725A4', '2512172-1', '21113HK1', 'ABCDEFGHIJ0123456789', '0', '-/()'])(
    'accepts %s unchanged',
    (lot) => {
      expect(normaliseLot(lot)).toEqual({ ok: true, lot })
    }
  )

  it('accepts at most 20 characters', () => {
    expect(LOT_MAX_LENGTH).toBe(20)
    expect(normaliseLot('A'.repeat(20))).toMatchObject({ ok: true })
    const result = normaliseLot('A'.repeat(21))
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toMatch(/20/)
  })

  it.each(['VRTy T002', 'VRTY  T002', 'A B'])('refuses %j with the GS1 space message', (lot) => {
    expect(normaliseLot(lot)).toEqual({ ok: false, message: 'GS1 cannot encode a space in a Lot.' })
  })

  it.each(['', '   '])('refuses an empty Lot %j', (lot) => {
    const result = normaliseLot(lot)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toMatch(/Enter/)
  })

  it.each([
    'A.B',
    'A_B',
    'A#1',
    'A&1',
    'A,1',
    'A\t1',
    'É1',
    'Ａ1', // full-width A
    'ıA1', // dotless i upper-cases to I in JavaScript; it must be refused, not turned into I
    'ſA1' // long s upper-cases to S in JavaScript
  ])('refuses %j and lists the allowed characters', (lot) => {
    const result = normaliseLot(lot)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toContain('A–Z, 0–9, "-", "/", "(" and ")"')
  })
})
