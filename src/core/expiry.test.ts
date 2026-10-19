import { describe, expect, it } from 'vitest'
import { checkExpiry, expiryToGs1, formatExpiry, parseExpiry, parseIsoDate } from './expiry'

/** Parses an entry that the test expects to be valid. */
function parsed(input: string) {
  const result = parseExpiry(input)
  if (!result.ok) throw new Error(`${input}: ${result.message}`)
  return result.expiry
}

describe('parseExpiry', () => {
  it('parses 8 digits ddmmyyyy', () => {
    expect(parseExpiry('31122027')).toEqual({ ok: true, expiry: { year: 2027, month: 12, day: 31 } })
    expect(parseExpiry('01012030')).toEqual({ ok: true, expiry: { year: 2030, month: 1, day: 1 } })
  })

  it('ignores spaces around the entry', () => {
    expect(parseExpiry(' 31122027 ')).toEqual(parseExpiry('31122027'))
  })

  it('accepts 29 February in a leap year only', () => {
    expect(parseExpiry('29022028')).toMatchObject({ ok: true })
    expect(parseExpiry('29022027')).toMatchObject({ ok: false })
  })

  it.each(['', '3112202', '311220277', '31-12-2027', '31/12/27', '3112202a', '3112 2027', '２０２７１２３１'])(
    'refuses %j: not 8 digits',
    (input) => {
      const result = parseExpiry(input)
      expect(result).toMatchObject({ ok: false })
      if (!result.ok) expect(result.message).toMatch(/8 digits/)
    }
  )

  it.each(['32122027', '00122027', '31042027', '30022028', '31002027', '31132027', '01002027'])(
    'refuses %s: no such date',
    (input) => {
      expect(parseExpiry(input)).toMatchObject({ ok: false })
    }
  )

  it.each(['31121999', '01012100'])('refuses %s: GS1 expiry carries only years 2000–2099', (input) => {
    const result = parseExpiry(input)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toMatch(/2000/)
  })

  it('says what is wrong with an impossible date', () => {
    const month = parseExpiry('31132027')
    const day = parseExpiry('31042027')
    expect(month.ok || month.message).toMatch(/month/i)
    expect(day.ok || day.message).toMatch(/day/i)
  })
})

describe('expiryToGs1 (AI 17, YYMMDD)', () => {
  it('encodes 31122027 as 271231', () => {
    expect(expiryToGs1(parsed('31122027'))).toBe('271231')
  })

  it('encodes a month-only pack entered as day 01 as YYMM01, never YYMM00 (ADR-0001)', () => {
    expect(expiryToGs1(parsed('01122027'))).toBe('271201')
  })

  it('zero-pads every part', () => {
    expect(expiryToGs1(parsed('05032031'))).toBe('310305')
    expect(expiryToGs1(parsed('01012000'))).toBe('000101')
  })
})

describe('formatExpiry (dd MMM yyyy)', () => {
  it('shows 31122027 as 31 DEC 2027', () => {
    expect(formatExpiry(parsed('31122027'))).toBe('31 DEC 2027')
    expect(formatExpiry(parsed('01122027'))).toBe('01 DEC 2027')
  })

  it('uses English upper-case month abbreviations, whatever the locale', () => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((month) =>
      formatExpiry(parsed(`05${month}2028`))
    )
    expect(months).toEqual([
      '05 JAN 2028',
      '05 FEB 2028',
      '05 MAR 2028',
      '05 APR 2028',
      '05 MAY 2028',
      '05 JUN 2028',
      '05 JUL 2028',
      '05 AUG 2028',
      '05 SEP 2028',
      '05 OCT 2028',
      '05 NOV 2028',
      '05 DEC 2028'
    ])
  })
})

describe('parseIsoDate', () => {
  it('parses yyyy-mm-dd', () => {
    expect(parseIsoDate('2026-10-19')).toEqual({ year: 2026, month: 10, day: 19 })
  })

  it.each(['', '2026-10-1', '19-10-2026', '2026-02-30', '2026-13-01', '2026-10-19T00:00'])('refuses %j', (input) => {
    expect(parseIsoDate(input)).toBeNull()
  })
})

describe('checkExpiry against today', () => {
  const today = '2026-10-19'

  it('accepts an expiry 3 months or more away, with no warning', () => {
    expect(checkExpiry(parsed('31122027'), today)).toEqual({ ok: true, warning: null })
    expect(checkExpiry(parsed('19012027'), today)).toEqual({ ok: true, warning: null })
  })

  it('refuses an expiry that has passed', () => {
    const result = checkExpiry(parsed('18102026'), today)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toMatch(/passed/)
    expect(checkExpiry(parsed('01012026'), today)).toMatchObject({ ok: false })
  })

  it('warns, but still accepts, an expiry earlier than today + 3 calendar months', () => {
    for (const input of ['19102026', '20102026', '18012027']) {
      const result = checkExpiry(parsed(input), today)
      expect(result).toMatchObject({ ok: true })
      if (result.ok) expect(result.warning).toMatch(/3 months/)
    }
  })

  it('names the date the 3 months run to in the warning', () => {
    const result = checkExpiry(parsed('20102026'), today)
    expect(result.ok && result.warning).toMatch(/19 JAN 2027/)
  })

  it('counts 3 months from the end of a month as the last day of the target month', () => {
    // 30 Nov 2026 + 3 months → 28 Feb 2027 (no 30 Feb).
    expect(checkExpiry(parsed('27022027'), '2026-11-30')).toMatchObject({ ok: true, warning: expect.any(String) })
    expect(checkExpiry(parsed('28022027'), '2026-11-30')).toEqual({ ok: true, warning: null })
    // 30 Nov 2027 + 3 months → 29 Feb 2028 (leap year).
    expect(checkExpiry(parsed('28022028'), '2027-11-30')).toMatchObject({ ok: true, warning: expect.any(String) })
    expect(checkExpiry(parsed('29022028'), '2027-11-30')).toEqual({ ok: true, warning: null })
  })

  it('carries the 3 months over a year end', () => {
    expect(checkExpiry(parsed('30032027'), '2026-12-31')).toMatchObject({ ok: true, warning: expect.any(String) })
    expect(checkExpiry(parsed('31032027'), '2026-12-31')).toEqual({ ok: true, warning: null })
  })

  it('refuses an expiry so far ahead that GS1 scanners would read its year as last century', () => {
    // GS1 century rule: a YY 51 or more years ahead of this year is read as 19YY.
    expect(checkExpiry(parsed('31122076'), today)).toEqual({ ok: true, warning: null })
    expect(checkExpiry(parsed('01012077'), today)).toMatchObject({ ok: false })
  })

  it('throws on a malformed today: the caller must pass the local date as yyyy-mm-dd', () => {
    expect(() => checkExpiry(parsed('31122027'), '19/10/2026')).toThrow()
  })
})
