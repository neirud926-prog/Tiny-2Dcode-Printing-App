/**
 * Label builder and element-string decoder (the self-check).
 *
 * A label carries AI (01) the Internal GTIN, AI (17) the Expiry and AI (10) the Lot, in that order,
 * so the Lot is last and needs no trailing separator: the Lot is everything after AI 10. The element
 * string is what a scanner transmits after the symbology identifier `]d2` (FNC1 implicit).
 *
 * Pure: no Electron, no file access, never reads the clock.
 */

import { checkExpiry, expiryToGs1, formatExpiry, parseExpiry, parseGs1Expiry } from './expiry'
import {
  decodeInternalGtin,
  encodeInternalGtin,
  packVolumeMlForDigit,
  type PackVolumeDigit,
  type PackVolumeMl
} from './internalGtin'
import { isPrintableLot, normaliseLot } from './lot'

export const MIN_COPIES = 1
export const MAX_COPIES = 99

/** What staff entered on the label form. */
export interface LabelRequest {
  readonly itemCode: string
  /** Pack Volume digit per ADR-0002; 0 for no volume. */
  readonly packVolumeDigit: number
  /** 8 digits `ddmmyyyy` (ADR-0001: day 01 for a month-only pack). */
  readonly expiry: string
  readonly lot: string
  readonly copies: number
}

export type LabelField = 'itemCode' | 'packVolume' | 'expiry' | 'lot' | 'copies' | 'selfCheck'

export interface FieldMessage {
  readonly field: LabelField
  readonly message: string
}

/** A label ready to render: the encoded data and the text shown on it. */
export interface Label {
  readonly internalGtin: string
  /** `01`+GTIN+`17`+YYMMDD+`10`+Lot, as a scanner transmits it (FNC1 implicit, no trailing separator). */
  readonly elementString: string
  /** Human-readable bracketed form `(01)…(17)…(10)…`. */
  readonly hri: string
  readonly itemCode: string
  readonly packVolumeDigit: PackVolumeDigit
  /** e.g. `60 mL`; null when no Pack Volume is encoded. */
  readonly packVolumeText: string | null
  /** AI (17) data, YYMMDD. */
  readonly expiryYymmdd: string
  /** e.g. `31 DEC 2027`. */
  readonly expiryText: string
  readonly lot: string
  readonly copies: number
}

/** What an element string decodes to. */
export interface DecodedLabelData {
  readonly internalGtin: string
  readonly itemCode: string
  readonly packVolumeDigit: PackVolumeDigit
  readonly packVolumeMl: PackVolumeMl | null
  readonly expiryYymmdd: string
  readonly expiryText: string
  readonly lot: string
}

export type BuildLabelResult =
  | { ok: true; label: Label; decoded: DecodedLabelData; warnings: FieldMessage[] }
  | { ok: false; errors: FieldMessage[]; warnings: FieldMessage[] }

/**
 * Validates a request and builds its label, then decodes the label's element string and refuses it
 * unless every field decodes back to what the label shows. `today` is the local date as `yyyy-mm-dd`.
 */
export function buildLabel(request: LabelRequest, options: { today: string }): BuildLabelResult {
  const errors: FieldMessage[] = []
  const warnings: FieldMessage[] = []

  let itemCode: string | null = null
  let internalGtin: string | null = null
  let packVolumeDigit: PackVolumeDigit = 0
  if (request.itemCode === '') {
    errors.push({ field: 'itemCode', message: 'Enter an Item Code.' })
  } else {
    const encoded = encodeInternalGtin(request.itemCode, request.packVolumeDigit)
    if (encoded.ok) {
      itemCode = encoded.itemCode
      internalGtin = encoded.internalGtin
      packVolumeDigit = encoded.packVolumeDigit
    } else {
      errors.push({ field: encoded.reason === 'pack-volume-digit' ? 'packVolume' : 'itemCode', message: encoded.message })
    }
  }

  let expiryYymmdd: string | null = null
  let expiryText: string | null = null
  const parsedExpiry = parseExpiry(request.expiry)
  if (!parsedExpiry.ok) {
    errors.push({ field: 'expiry', message: parsedExpiry.message })
  } else {
    const checked = checkExpiry(parsedExpiry.expiry, options.today)
    if (!checked.ok) {
      errors.push({ field: 'expiry', message: checked.message })
    } else {
      if (checked.warning) warnings.push({ field: 'expiry', message: checked.warning })
      expiryYymmdd = expiryToGs1(parsedExpiry.expiry)
      expiryText = formatExpiry(parsedExpiry.expiry)
    }
  }

  const normalisedLot = normaliseLot(request.lot)
  if (!normalisedLot.ok) errors.push({ field: 'lot', message: normalisedLot.message })

  const { copies } = request
  if (!Number.isInteger(copies) || copies < MIN_COPIES || copies > MAX_COPIES) {
    errors.push({ field: 'copies', message: `Copies must be a whole number from ${MIN_COPIES} to ${MAX_COPIES}.` })
  }

  if (errors.length > 0 || !itemCode || !internalGtin || !expiryYymmdd || !expiryText || !normalisedLot.ok) {
    return { ok: false, errors, warnings }
  }

  const { lot } = normalisedLot
  const packVolumeMl = packVolumeMlForDigit(packVolumeDigit)
  const label: Label = {
    internalGtin,
    elementString: `01${internalGtin}17${expiryYymmdd}10${lot}`,
    hri: `(01)${internalGtin}(17)${expiryYymmdd}(10)${lot}`,
    itemCode,
    packVolumeDigit,
    packVolumeText: packVolumeMl === null ? null : `${packVolumeMl} mL`,
    expiryYymmdd,
    expiryText,
    lot,
    copies
  }

  const selfCheck = selfCheckLabel(label)
  if (!selfCheck.ok) return { ok: false, errors: [{ field: 'selfCheck', message: selfCheck.message }], warnings }
  return { ok: true, label, decoded: selfCheck.decoded, warnings }
}

export type DecodeLabelDataResult = { ok: true; data: DecodedLabelData } | { ok: false; message: string }

/**
 * Strictly decodes this app's element string: `01` + 14 digits, `17` + 6 digits, `10` + the Lot
 * (everything after AI 10), with a v1 Internal GTIN, a real YYMMDD date (day 00 refused) and a Lot
 * that is valid exactly as printed. No symbology identifier, brackets or separators.
 */
export function decodeLabelData(elementString: string): DecodeLabelDataResult {
  const match = /^01([0-9]{14})17([0-9]{6})10(.+)$/s.exec(elementString)
  if (!match) {
    return refuse('The data is not 01 + 14-digit GTIN, 17 + 6-digit Expiry, 10 + Lot.')
  }
  const [, internalGtin, expiryYymmdd, lot] = match

  const gtin = decodeInternalGtin(internalGtin)
  if (!gtin.ok) return refuse(gtin.message)

  const expiry = parseGs1Expiry(expiryYymmdd)
  if (!expiry) return refuse(`The Expiry ${expiryYymmdd} is not a real date (YYMMDD, day 01–31).`)

  if (!isPrintableLot(lot)) return refuse(`The Lot ${JSON.stringify(lot)} is not a valid Lot.`)

  return {
    ok: true,
    data: {
      internalGtin,
      itemCode: gtin.itemCode,
      packVolumeDigit: gtin.packVolumeDigit,
      packVolumeMl: gtin.packVolumeMl,
      expiryYymmdd,
      expiryText: formatExpiry(expiry),
      lot
    }
  }

  function refuse(message: string): DecodeLabelDataResult {
    return { ok: false, message }
  }
}

export type SelfCheckResult = { ok: true; decoded: DecodedLabelData } | { ok: false; message: string }

/**
 * The self-check: decodes the label's element string and confirms every field equals what the label
 * shows, and that the bracketed form says the same. Any difference makes the label unprintable.
 */
export function selfCheckLabel(label: Label): SelfCheckResult {
  const decoded = decodeLabelData(label.elementString)
  if (!decoded.ok) return { ok: false, message: `Self-check failed: ${decoded.message}` }
  const { data } = decoded

  const comparisons: [string, unknown, unknown][] = [
    ['Internal GTIN', data.internalGtin, label.internalGtin],
    ['Item Code', data.itemCode, label.itemCode],
    ['Pack Volume', data.packVolumeDigit, label.packVolumeDigit],
    ['Pack Volume', data.packVolumeMl === null ? null : `${data.packVolumeMl} mL`, label.packVolumeText],
    ['Expiry', data.expiryYymmdd, label.expiryYymmdd],
    ['Expiry', data.expiryText, label.expiryText],
    ['Lot', data.lot, label.lot]
  ]
  for (const [what, decodedValue, shownValue] of comparisons) {
    if (decodedValue !== shownValue) {
      return {
        ok: false,
        message: `Self-check failed: the ${what} decodes to ${JSON.stringify(decodedValue)}, but the label shows ${JSON.stringify(shownValue)}.`
      }
    }
  }
  const expectedHri = `(01)${data.internalGtin}(17)${data.expiryYymmdd}(10)${data.lot}`
  if (label.hri !== expectedHri) {
    return { ok: false, message: `Self-check failed: ${label.hri} does not match the element string.` }
  }
  return { ok: true, decoded: data }
}
