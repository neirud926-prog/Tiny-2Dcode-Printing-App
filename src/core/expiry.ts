/**
 * Expiry rules (docs/adr/0001-month-only-expiry-day-01.md).
 *
 * Staff always enter 8 digits `ddmmyyyy`; a month-only pack is entered as day 01 and so encoded
 * as `YYMM01`, never GS1's `YYMM00`. AI (17) carries `YYMMDD`. On screen and on the label the
 * Expiry reads `dd MMM yyyy` with English upper-case months, whatever language Windows uses.
 *
 * Pure: never reads the clock. Callers pass today's local date as `yyyy-mm-dd`.
 */

/** A calendar date; `month` is 1–12. */
export interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

export type ParseExpiryResult = { ok: true; expiry: CalendarDate } | { ok: false; message: string }

/** Expiry shorter than this many calendar months from today gets a warning. */
export const SHORT_EXPIRY_MONTHS = 3

/**
 * GS1 century rule (General Specifications, "Determination of century in dates"): a two-digit year
 * 51 or more years ahead of the current year is read as last century. An Expiry further ahead than
 * this would scan as 19YY.
 */
const GS1_MAX_YEARS_AHEAD = 50

const MONTH_ABBREVIATIONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Parses an Expiry entered as 8 digits `ddmmyyyy` (spaces around it are ignored). */
export function parseExpiry(input: string): ParseExpiryResult {
  const entry = input.trim()
  if (!/^[0-9]{8}$/.test(entry)) {
    return refuse('Enter the Expiry as 8 digits, ddmmyyyy (e.g. 31122027).')
  }
  const day = Number(entry.slice(0, 2))
  const month = Number(entry.slice(2, 4))
  const year = Number(entry.slice(4, 8))

  if (month < 1 || month > 12) return refuse(`There is no month ${entry.slice(2, 4)}; enter ddmmyyyy.`)
  if (year < 2000 || year > 2099) return refuse('The Expiry year must be from 2000 to 2099.')
  if (day < 1 || day > daysInMonth(year, month)) {
    return refuse(`There is no day ${entry.slice(0, 2)} in ${MONTH_ABBREVIATIONS[month - 1]} ${year}.`)
  }
  return { ok: true, expiry: { year, month, day } }

  function refuse(message: string): ParseExpiryResult {
    return { ok: false, message }
  }
}

/** AI (17) data: `YYMMDD`. The year must be 2000–2099, as `parseExpiry` guarantees. */
export function expiryToGs1(expiry: CalendarDate): string {
  return pad2(expiry.year % 100) + pad2(expiry.month) + pad2(expiry.day)
}

/**
 * Parses AI (17) data `YYMMDD` as 20YY. Refuses day 00 (GS1's "end of month"), which this app
 * never prints (ADR-0001), and any impossible date.
 */
export function parseGs1Expiry(yymmdd: string): CalendarDate | null {
  if (!/^[0-9]{6}$/.test(yymmdd)) return null
  return validDate(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)), Number(yymmdd.slice(4, 6)))
}

/** `dd MMM yyyy` with English upper-case months, e.g. `31 DEC 2027`; independent of locale. */
export function formatExpiry(date: CalendarDate): string {
  return `${pad2(date.day)} ${MONTH_ABBREVIATIONS[date.month - 1]} ${date.year}`
}

/**
 * The local calendar date of `date` as `yyyy-mm-dd` (not UTC: a label printed at 7 am is dated
 * today). The caller reads the clock; this only formats.
 */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** Parses an ISO local date `yyyy-mm-dd`; null if malformed or impossible. */
export function parseIsoDate(iso: string): CalendarDate | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(iso)
  return match ? validDate(Number(match[1]), Number(match[2]), Number(match[3])) : null
}

export type CheckExpiryResult = { ok: true; warning: string | null } | { ok: false; message: string }

/**
 * Judges an Expiry against today (local date, `yyyy-mm-dd`): a passed Expiry is refused; one
 * earlier than today + 3 calendar months is accepted with a warning. Expiry on today itself has
 * not passed. Throws if `today` is malformed, which is a programming error.
 */
export function checkExpiry(expiry: CalendarDate, today: string): CheckExpiryResult {
  const todayDate = parseIsoDate(today)
  if (!todayDate) throw new Error(`today must be a date as yyyy-mm-dd; got ${JSON.stringify(today)}`)

  if (compareDates(expiry, todayDate) < 0) {
    return { ok: false, message: `This Expiry (${formatExpiry(expiry)}) has already passed.` }
  }
  if (expiry.year - todayDate.year > GS1_MAX_YEARS_AHEAD) {
    return {
      ok: false,
      message: `The Expiry year ${expiry.year} is too far ahead: scanners would read it as ${expiry.year - 100}.`
    }
  }
  const shortUntil = addMonths(todayDate, SHORT_EXPIRY_MONTHS)
  const warning =
    compareDates(expiry, shortUntil) < 0
      ? `Short expiry: less than ${SHORT_EXPIRY_MONTHS} months away (before ${formatExpiry(shortUntil)}).`
      : null
  return { ok: true, warning }
}

/** Adds calendar months; a day that does not exist in the target month becomes its last day. */
function addMonths(date: CalendarDate, months: number): CalendarDate {
  const monthIndex = date.month - 1 + months
  const year = date.year + Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) }
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

function validDate(year: number, month: number, day: number): CalendarDate | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
