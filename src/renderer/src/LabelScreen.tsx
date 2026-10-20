import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatExpiry, parseExpiry } from '../../core/expiry'
import { encodeInternalGtin, type PackVolumeDigit } from '../../core/internalGtin'
import { isLiquid, itemListProblems, type ItemListEntry, type ItemListInfo } from '../../core/itemList'
import { buildLabel, type BuildLabelResult, type FieldMessage, type LabelField, type LabelRequest } from '../../core/label'
import { lotPicker, type LotChoice } from '../../core/lotPicker'
import { itemCodeFromScan, type ScanSource } from '../../core/scanInput'
import { isStockOnhandForToday, type StockLot, type StockOnhandInfo } from '../../core/stockOnhand'
import type { ItemLookup, PrintOutcome } from '../../preload/api'
import type { PcSettings } from '../../render/printSettings'
import { LabelPreview } from './LabelPreview'
import { LotPicker, type LotPickerView } from './LotPicker'
import { OutcomeMessage } from './OutcomeMessage'
import { PACK_VOLUME_CHOICES } from './packVolumeChoices'
import { PendingLabelsDialog, usePendingLabels } from './PendingLabels'
import { importedForToday, StockOnhandOutcome, useStockOnhandImport } from './StockOnhandImport'
import { useToday } from './today'
import { UnknownItemDialog } from './UnknownItemDialog'

type FormField = 'itemCode' | 'expiry' | 'lot' | 'copies'
type FormValues = Record<FormField, string>
/** Fields whose messages show once left; Pack Volume is a choice, not a text field. */
type TouchField = FormField | 'packVolume'

/** Form order: Enter moves to the next field (via Pack Volume for a liquid). */
const FORM_FIELDS: readonly FormField[] = ['itemCode', 'expiry', 'lot', 'copies']

/** A field's errors show once it has been left, or once its entry is complete enough to judge. */
const COMPLETE_LENGTH: Record<FormField, number> = { itemCode: 6, expiry: 8, lot: 1, copies: 1 }

const EMPTY_FORM: FormValues = { itemCode: '', expiry: '', lot: '', copies: '1' }

const LOOKUP_PENDING = 'Press Enter to look up this Item Code in the Item List.'
const LOOKUP_RUNNING = 'Looking up the Item Code…'
const CHOOSE_PACK_VOLUME = 'Choose the Pack Volume.'
const PICKED_HINT = 'From Stock Onhand; choose "Type lot manually" to change it.'

/** What the Item List said about an Item Code, for the Item List it was asked of (`stamp`). */
type Lookup =
  | { readonly code: string; readonly stamp: string; readonly status: 'checking' }
  | { readonly code: string; readonly stamp: string; readonly status: 'found'; readonly item: ItemListEntry }
  | { readonly code: string; readonly stamp: string; readonly status: 'unknown' }
  | { readonly code: string; readonly stamp: string; readonly status: 'failed'; readonly message: string }

/** What the scan-input parser made of the Item Code field (on Enter or leaving it), for the value then in the field. */
type ItemCodeScan = { readonly value: string; readonly source: ScanSource } | { readonly value: string; readonly error: string }

const SCAN_SOURCE_HINTS: Record<ScanSource, string | null> = {
  typed: null,
  'shelf-qr': 'From shelf label',
  'bag-label-ip': 'From in-patient dispensing-bag label'
}

/** The Item Code's Lots in the Stock Onhand they were read from (`stamp`), or why they could not be read. */
type StockLots = { readonly code: string; readonly stamp: string } & ({ readonly lots: readonly StockLot[] } | { readonly error: string })

/** Where Lot and Expiry came from: a Lot picked from the Stock Onhand (as recorded), or typed. */
type LotSource = { readonly kind: 'picked'; readonly lot: string } | { readonly kind: 'manual' }

/** Upper-cases a–z as staff type (Caps Lock need not matter); the label core does the same. */
function upperCaseAscii(value: string): string {
  return value.replace(/[a-z]/g, (letter) => letter.toUpperCase())
}

function parseCopies(value: string): number {
  return /^[0-9]{1,3}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

function isWellFormedItemCode(itemCode: string): boolean {
  return encodeInternalGtin(itemCode, 0).ok
}

interface LabelScreenProps {
  settings: PcSettings
  itemList: ItemListInfo
  /** A newer Item List is in use (imported from the dialog, or by another PC). */
  onItemListChanged(info: ItemListInfo): void
  /** The Stock Onhand in use, whatever its Report Date; null if none. */
  stockOnhand: StockOnhandInfo | null
  /** A newer Stock Onhand is in use (imported here, or by another PC). */
  onStockOnhandChanged(info: StockOnhandInfo): void
  /** Where the Pending Labels button goes in the app header (shown while this tab is open). */
  headerSlot: HTMLElement | null
  /** Another tab is open; the form keeps what was typed. */
  hidden?: boolean
}

/** The label screen: the form on the left, the live preview and self-check on the right. */
export function LabelScreen({
  settings,
  itemList,
  onItemListChanged,
  stockOnhand,
  onStockOnhandChanged,
  headerSlot,
  hidden = false
}: LabelScreenProps): React.JSX.Element {
  const today = useToday()
  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [touched, setTouched] = useState<ReadonlySet<TouchField>>(new Set())
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [packVolume, setPackVolume] = useState<PackVolumeDigit | null>(null)
  const [unknownDialogFor, setUnknownDialogFor] = useState<string | null>(null)
  const [scan, setScan] = useState<ItemCodeScan | null>(null)
  /** Where focus goes once the screen has updated (and any dialog has closed). */
  const [pendingFocus, setPendingFocus] = useState<'itemCode' | 'packVolume' | 'expiry' | null>(null)
  const [printing, setPrinting] = useState(false)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)
  const [stockLots, setStockLots] = useState<StockLots | null>(null)
  const [lotSource, setLotSource] = useState<LotSource | null>(null)
  const stockImporter = useStockOnhandImport(stockOnhand, onStockOnhandChanged)
  const [pendingOpen, setPendingOpen] = useState(false)
  const pending = usePendingLabels(itemList.importedAt)
  const inputs = useRef<Partial<Record<FormField, HTMLInputElement | null>>>({})
  const packVolumeGroup = useRef<HTMLDivElement | null>(null)
  const lotPickerGroup = useRef<HTMLDivElement | null>(null)

  const stamp = itemList.importedAt
  /** The lookup for the Item Code as it is now, against the Item List in use. */
  const currentLookup = lookup && lookup.code === values.itemCode && lookup.stamp === stamp ? lookup : null
  const item = currentLookup?.status === 'found' ? currentLookup.item : null
  const liquid = item !== null && isLiquid(item)

  // The Lot picker: the found item's Lots, from the Stock Onhand in use only if it is dated today.
  const stockStamp = stockOnhand?.importedAt ?? ''
  const currentStockLots = item && stockLots && stockLots.code === item.itemCode && stockLots.stamp === stockStamp ? stockLots : null
  const pickerView = useMemo<LotPickerView | null>(() => {
    if (!item) return null
    if (!isStockOnhandForToday(stockOnhand, today)) return lotPicker(stockOnhand, item.itemCode, [], today)
    if (!currentStockLots) return { status: 'loading' }
    if ('error' in currentStockLots) return { status: 'error', message: currentStockLots.error }
    return lotPicker(stockOnhand, item.itemCode, currentStockLots.lots, today)
  }, [item, stockOnhand, currentStockLots, today])
  /** The picked Lot while it is still offered: Lot and Expiry are then locked. */
  const pickedChoice =
    lotSource?.kind === 'picked' && pickerView?.status === 'choices'
      ? (pickerView.choices.find((choice) => choice.lot === lotSource.lot && choice.fill !== null) ?? null)
      : null
  const locked = pickedChoice !== null

  const request = useMemo<LabelRequest>(
    () => ({
      itemCode: values.itemCode,
      packVolumeDigit: liquid ? (packVolume ?? 0) : 0,
      expiry: values.expiry,
      lot: values.lot,
      copies: parseCopies(values.copies)
    }),
    [values, liquid, packVolume]
  )
  const labelResult = useMemo(() => buildLabel(request, { today }), [request, today])

  /** The Item List's say on the label: listed, with a Pack Volume chosen for a liquid. */
  const itemErrors = useMemo<FieldMessage[]>(() => {
    if (!isWellFormedItemCode(request.itemCode)) return [] // the label core explains the format
    if (!currentLookup) return [{ field: 'itemCode', message: LOOKUP_PENDING }]
    switch (currentLookup.status) {
      case 'checking':
        return [{ field: 'itemCode', message: LOOKUP_RUNNING }]
      case 'failed':
        return [{ field: 'itemCode', message: `The Item List could not be searched: ${currentLookup.message}` }]
      case 'unknown':
        return itemListProblems(null, request)
      case 'found': {
        const problems = itemListProblems(currentLookup.item, request)
        return isLiquid(currentLookup.item) && packVolume === null ? [...problems, { field: 'packVolume', message: CHOOSE_PACK_VOLUME }] : problems
      }
    }
  }, [currentLookup, request, packVolume])

  /** The label, refused unless the Item List accepts it too. */
  const result = useMemo<BuildLabelResult>(
    () =>
      itemErrors.length === 0
        ? labelResult
        : { ok: false, errors: [...itemErrors, ...(labelResult.ok ? [] : labelResult.errors)], warnings: labelResult.warnings },
    [labelResult, itemErrors]
  )

  const errors = result.ok ? [] : result.errors
  const messagesFor = (list: FieldMessage[], field: LabelField): string[] =>
    list.filter((message) => message.field === field).map((message) => message.message)
  const visibleErrors = (field: FormField): string[] =>
    touched.has(field) || values[field].trim().length >= COMPLETE_LENGTH[field] ? messagesFor(errors, field) : []
  const awaitingLookup = itemErrors.some((error) => error.message === LOOKUP_PENDING || error.message === LOOKUP_RUNNING)
  const currentScan = scan && scan.value === values.itemCode ? scan : null
  // An unrecognised scan says so in place of the label core's Item Code format messages.
  const itemCodeErrors =
    currentScan && 'error' in currentScan
      ? [currentScan.error]
      : visibleErrors('itemCode').filter((message) => message !== LOOKUP_PENDING && message !== LOOKUP_RUNNING)
  const packVolumeErrors = touched.has('packVolume') ? messagesFor(errors, 'packVolume') : []

  const parsedExpiry = parseExpiry(values.expiry)
  const expiryConfirmation = parsedExpiry.ok ? formatExpiry(parsedExpiry.expiry) : null

  // Lookups are async and outlive the render that started them, so they read and write through refs.
  const lookupRef = useRef<Lookup | null>(lookup)
  const stampRef = useRef(stamp)
  stampRef.current = stamp
  const itemCodeRef = useRef(values.itemCode)
  itemCodeRef.current = values.itemCode

  function storeLookup(next: Lookup): void {
    lookupRef.current = next
    setLookup(next)
  }

  // The found item's Lots, read again when another Stock Onhand comes into use. The answer also tells
  // of a Stock Onhand another PC imported since.
  const lotsItemCode = item?.itemCode ?? null
  const stockStampRef = useRef(stockStamp)
  stockStampRef.current = stockStamp
  useEffect(() => {
    if (lotsItemCode === null) return
    let current = true
    window.api.getStockLots(lotsItemCode).then(
      (answer) => {
        if (!current) return
        const answeredStamp = answer.stockOnhand?.importedAt ?? ''
        if (answer.stockOnhand && answeredStamp !== stockStampRef.current) onStockOnhandChanged(answer.stockOnhand)
        setStockLots({ code: lotsItemCode, stamp: answeredStamp, lots: answer.lots })
      },
      (error: unknown) => {
        if (current) setStockLots({ code: lotsItemCode, stamp: stockStampRef.current, error: String(error) })
      }
    )
    return () => {
      current = false
    }
  }, [lotsItemCode, stockStamp]) // onStockOnhandChanged is the parent's setter; the stamp is read through a ref.

  // A newer Item List came into use (from Settings or another PC): look the Item Code up again in it.
  useEffect(() => {
    const previous = lookupRef.current
    if (previous && previous.status !== 'checking' && previous.code === itemCodeRef.current && previous.stamp !== stamp) {
      void checkItemCode(previous.code, 'never')
    }
  }, [stamp]) // Runs only when the Item List changes; checkItemCode reads refs, not this render's state.

  // A newer Item List made Pending Labels ready: show them, unless a dialog is already up.
  useEffect(() => {
    if (!pending.announce || unknownDialogFor !== null || hidden) return
    pending.clearAnnounce()
    setPendingOpen(true)
  }, [pending, unknownDialogFor, hidden])

  useEffect(() => {
    if (pendingFocus === null || unknownDialogFor !== null) return
    if (pendingFocus === 'packVolume') {
      const group = packVolumeGroup.current
      ;(group?.querySelector<HTMLInputElement>('input:checked') ?? group?.querySelector<HTMLInputElement>('input'))?.focus()
    } else if (pendingFocus === 'expiry') {
      // After the Item Code (and Pack Volume): the Lot picker if it offers a Lot to pick, else the Expiry.
      if (pickerView?.status === 'loading') return // wait for the item's Lots
      const group = lotPickerGroup.current
      const choice = group?.querySelector<HTMLInputElement>('input:checked') ?? group?.querySelector<HTMLInputElement>('input[data-pickable]')
      if (choice) choice.focus()
      else focusField('expiry')
    } else {
      focusField(pendingFocus)
    }
    setPendingFocus(null)
  }, [pendingFocus, unknownDialogFor, pickerView])

  function touch(...fields: TouchField[]): void {
    setTouched((previous) => new Set([...previous, ...fields]))
  }

  function change(field: FormField, value: string): void {
    const next = field === 'itemCode' || field === 'lot' ? upperCaseAscii(value) : value
    // A Lot picked for another item does not belong to the new one.
    const clearPicked = field === 'itemCode' && next !== values.itemCode && lotSource?.kind === 'picked'
    if (field === 'itemCode' && next !== values.itemCode) {
      setScan(null)
      setPackVolume(null)
      const untouched: readonly TouchField[] = clearPicked ? ['packVolume', 'lot', 'expiry'] : ['packVolume']
      setTouched((previous) => new Set([...previous].filter((name) => !untouched.includes(name))))
      setLotSource(null)
    }
    setValues((previous) => ({ ...previous, ...(clearPicked ? { lot: '', expiry: '' } : {}), [field]: next }))
    setOutcome(null)
  }

  /** Fills Lot and Expiry from a Lot in today's Stock Onhand, exactly as recorded, and locks them. */
  function pickLot(choice: LotChoice): void {
    const fill = choice.fill
    if (!fill) return
    setValues((previous) => ({ ...previous, lot: fill.lot, expiry: fill.expiry }))
    setLotSource({ kind: 'picked', lot: choice.lot })
    touch('lot', 'expiry')
    setOutcome(null)
  }

  /** "Type lot manually": unlocks Lot and Expiry, clearing a picked Lot. */
  function typeLotManually(): void {
    if (lotSource?.kind === 'picked') {
      setValues((previous) => ({ ...previous, lot: '', expiry: '' }))
      setTouched((previous) => new Set([...previous].filter((name) => name !== 'lot' && name !== 'expiry')))
    }
    setLotSource({ kind: 'manual' })
    setOutcome(null)
  }

  /** Enter on a picker choice: chooses it, then moves on to Copies (a picked Lot) or the Expiry (typing). */
  function enterOnLotChoice(choice: LotChoice | 'manual'): void {
    if (choice === 'manual') {
      if (lotSource?.kind !== 'manual') typeLotManually()
      focusField('expiry')
    } else if (choice.fill) {
      if (!(lotSource?.kind === 'picked' && lotSource.lot === choice.lot)) pickLot(choice)
      focusField('copies')
    }
  }

  /**
   * Runs the scan-input parser on the Item Code field (Enter or leaving it): a shelf QR, an in-patient
   * dispensing-bag label or surrounding spaces are replaced by the Item Code, which is returned for
   * lookup; an unrecognised value stays as it is, with an error, and null is returned.
   */
  function takeItemCode(): string | null {
    const raw = values.itemCode
    if (raw === '') return null // the label core asks for an Item Code
    const scanned = itemCodeFromScan(raw)
    if (!scanned.ok) {
      setScan({ value: raw, error: scanned.message })
      return null
    }
    if (scanned.itemCode !== raw) {
      change('itemCode', scanned.itemCode)
      setScan({ value: scanned.itemCode, source: scanned.source })
    }
    return scanned.itemCode
  }

  /**
   * Looks `code` up in the Item List and returns what it found, reusing an answer already given for
   * the Item List in use unless `fresh`. An unknown Item Code opens the dialog: `always` (Enter),
   * `if-new` (leaving the field, so closing the dialog and moving on does not reopen it) or `never`.
   */
  async function checkItemCode(code: string, dialog: 'always' | 'if-new' | 'never', { fresh = false } = {}): Promise<Lookup | null> {
    if (!isWellFormedItemCode(code)) return null
    const previous = lookupRef.current
    const known =
      !fresh && previous && previous.code === code && previous.stamp === stampRef.current && (previous.status === 'found' || previous.status === 'unknown')
        ? previous
        : null
    let found: Lookup
    if (known) {
      found = known
    } else {
      const checking: Lookup = { code, stamp: stampRef.current, status: 'checking' }
      storeLookup(checking)
      let answer: ItemLookup
      try {
        answer = await window.api.lookupItem(code)
      } catch (error) {
        found = { code, stamp: checking.stamp, status: 'failed', message: String(error) }
        if (lookupRef.current === checking) storeLookup(found)
        return found
      }
      const answeredStamp = answer.itemList?.importedAt ?? checking.stamp
      if (answer.itemList && answeredStamp !== stampRef.current) onItemListChanged(answer.itemList)
      found = answer.status === 'found' ? { code, stamp: answeredStamp, status: 'found', item: answer.item } : { code, stamp: answeredStamp, status: 'unknown' }
      // A later lookup (another Item Code typed meanwhile) wins over this one.
      if (lookupRef.current !== checking) return found
      storeLookup(found)
    }
    if (found.status === 'unknown' && (dialog === 'always' || (dialog === 'if-new' && !known))) setUnknownDialogFor(code)
    if (found.status === 'found') setUnknownDialogFor((open) => (open === code ? null : open))
    return found
  }

  /** After the Item Code: the Pack Volume choice for a liquid, otherwise the Expiry. */
  function focusAfterItemCode(found: Lookup | null): void {
    if (found?.status === 'found') setPendingFocus(isLiquid(found.item) ? 'packVolume' : 'expiry')
  }

  function focusField(field: FormField): void {
    inputs.current[field]?.focus()
    inputs.current[field]?.select()
  }

  /** Saves the form as a Pending Label (its Item Code is not in the Item List); on success the form is cleared. */
  async function savePending(packVolumeDigit: number | null): Promise<{ ok: boolean; message: string }> {
    const saved = await window.api.savePendingLabel({
      itemCode: values.itemCode,
      packVolumeDigit,
      expiry: values.expiry,
      lot: values.lot,
      copies: parseCopies(values.copies)
    })
    if (!saved.ok) return saved
    setValues(EMPTY_FORM)
    setTouched(new Set())
    setLookup(null)
    lookupRef.current = null
    setPackVolume(null)
    setScan(null)
    setLotSource(null)
    setOutcome({ ok: true, message: saved.message, warning: null })
    setUnknownDialogFor(null)
    setPendingFocus('itemCode')
    void pending.refresh()
    return saved
  }

  /** Sends the request (not the label): the main process rebuilds and checks it before printing. */
  async function print(): Promise<void> {
    if (!result.ok || printing) return
    setPrinting(true)
    setOutcome(null)
    try {
      setOutcome(await window.api.printLabel(request))
    } catch (error) {
      setOutcome({ ok: false, message: `Not printed: ${String(error)}` })
    } finally {
      setPrinting(false)
    }
  }

  function handleKeyDown(field: FormField, event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    touch(field)
    if (field === 'itemCode') {
      const code = takeItemCode()
      if (code !== null) void checkItemCode(code, 'always').then(focusAfterItemCode)
      return
    }
    const next = FORM_FIELDS[FORM_FIELDS.indexOf(field) + 1]
    if (next) focusField(next)
    else touch(...FORM_FIELDS, 'packVolume')
  }

  function fieldProps(field: FormField, className: string, invalid: boolean) {
    return {
      id: field,
      ref: (element: HTMLInputElement | null) => {
        inputs.current[field] = element
      },
      value: values[field],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(field, event.target.value),
      onBlur: () => {
        touch(field)
        // Leaving the Item Code takes it from a scan and looks it up; a newly found unknown one opens the dialog.
        if (field === 'itemCode' && unknownDialogFor === null) {
          const code = takeItemCode()
          if (code !== null) void checkItemCode(code, 'if-new')
        }
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(field, event),
      'aria-invalid': invalid,
      'aria-describedby': `${field}-messages`,
      autoComplete: 'off',
      spellCheck: false,
      className: invalid ? `${className} invalid` : className
    }
  }

  const scanHint = currentScan && 'source' in currentScan ? SCAN_SOURCE_HINTS[currentScan.source] : null
  const itemCodeHint =
    currentLookup?.status === 'checking'
      ? LOOKUP_RUNNING
      : awaitingLookup
        ? LOOKUP_PENDING
        : (scanHint ?? '6 characters, e.g. PARA01, or scan a label')

  return (
    <>
      {headerSlot &&
        !hidden &&
        createPortal(
          <button
            type="button"
            className={pending.ready > 0 ? 'button button--primary button--small' : 'button button--secondary button--small'}
            onClick={() => setPendingOpen(true)}
          >
            Pending Labels{pending.total > 0 ? ` (${pending.total}${pending.ready > 0 ? `, ${pending.ready} ready` : ''})` : ''}
          </button>,
          headerSlot
        )}

      <main className="layout">
        <section className="panel form" aria-label="Label details">
          <h2>Label</h2>

          <Field label="Item Code" field="itemCode" errors={itemCodeErrors} hint={itemCodeHint}>
            <input {...fieldProps('itemCode', 'code', itemCodeErrors.length > 0)} autoFocus />
          </Field>
          {item && (
            <p className="item-name" aria-live="polite">
              <span className="item-name__text">{item.name}</span>
              <span className="item-name__unit">{liquid ? 'liquid (mL)' : item.baseUnit}</span>
            </p>
          )}

          {liquid && (
            <fieldset className="field pack-volume" aria-describedby="packVolume-messages">
              <legend>Pack Volume (mL)</legend>
              <div className="segmented" role="radiogroup" aria-label="Pack Volume" ref={packVolumeGroup}>
                {PACK_VOLUME_CHOICES.map((choice) => (
                  <label key={choice.digit} className={packVolume === choice.digit ? 'segment segment--selected' : 'segment'}>
                    <input
                      type="radio"
                      name="packVolume"
                      aria-label={choice.name}
                      value={choice.digit}
                      checked={packVolume === choice.digit}
                      onChange={() => {
                        setPackVolume(choice.digit)
                        setOutcome(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        touch('packVolume')
                        setPendingFocus('expiry')
                      }}
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
              <div id="packVolume-messages" className="field__messages" aria-live="polite">
                <p className="message message--hint">Choose the bottle size; Other if it is not listed.</p>
                {packVolumeErrors.map((message) => (
                  <p key={message} className="message message--error">
                    {message}
                  </p>
                ))}
              </div>
            </fieldset>
          )}

          {pickerView && (
            <LotPicker
              view={pickerView}
              selected={lotSource?.kind === 'manual' ? 'manual' : (pickedChoice?.lot ?? null)}
              onPick={pickLot}
              onManual={typeLotManually}
              onEnter={enterOnLotChoice}
              onImport={() => void stockImporter.start()}
              importing={stockImporter.busy}
              importOutcome={
                stockImporter.state.status !== 'idle' && !importedForToday(stockImporter.state, today) ? (
                  <StockOnhandOutcome state={stockImporter.state} today={today} />
                ) : null
              }
              groupRef={lotPickerGroup}
            />
          )}

          <Field
            label="Expiry"
            field="expiry"
            errors={visibleErrors('expiry')}
            warnings={messagesFor(result.warnings, 'expiry')}
            hint={locked ? PICKED_HINT : 'Month-only pack? Enter day 01'}
            confirmation={visibleErrors('expiry').length === 0 ? expiryConfirmation : null}
          >
            <input
              {...fieldProps('expiry', locked ? 'code locked' : 'code', visibleErrors('expiry').length > 0)}
              readOnly={locked}
              onFocus={() => liquid && touch('packVolume')}
              inputMode="numeric"
              placeholder="ddmmyyyy"
            />
          </Field>

          <Field label="Lot" field="lot" errors={visibleErrors('lot')} hint={locked ? PICKED_HINT : 'A–Z, 0–9, "-", "/", "(" and ")"; up to 20'}>
            <input {...fieldProps('lot', locked ? 'code locked' : 'code', visibleErrors('lot').length > 0)} readOnly={locked} />
          </Field>

          <Field label="Copies" field="copies" errors={visibleErrors('copies')} hint="1–99">
            <input {...fieldProps('copies', 'copies', visibleErrors('copies').length > 0)} inputMode="numeric" />
          </Field>

          <div className="actions">
            <button type="button" className="print-button" disabled={!result.ok || printing} onClick={() => void print()}>
              {printing ? 'Printing…' : 'Print'}
            </button>
            {!result.ok && !outcome && <span className="actions__note">Complete the label to print.</span>}
          </div>
          <OutcomeMessage outcome={outcome} />
        </section>

        <LabelPreview result={result} size={settings.labelSize} />
      </main>

      {unknownDialogFor !== null && (
        <UnknownItemDialog
          itemCode={unknownDialogFor}
          itemList={itemList}
          onImported={onItemListChanged}
          recheck={async () => {
            const found = await checkItemCode(unknownDialogFor, 'never', { fresh: true })
            if (found?.status === 'found') focusAfterItemCode(found)
            return found?.status === 'found' || found?.status === 'unknown' ? found.status : null
          }}
          saveBlocked={labelResult.ok ? null : 'Complete the Expiry, Lot and Copies first (Change Item Code).'}
          onSavePending={savePending}
          onClose={() => {
            setUnknownDialogFor(null)
            touch('itemCode')
            setPendingFocus('itemCode')
          }}
        />
      )}
      {pendingOpen && <PendingLabelsDialog list={pending.list} refresh={pending.refresh} onClose={() => setPendingOpen(false)} />}
    </>
  )
}

interface FieldProps {
  label: string
  field: FormField
  errors: string[]
  warnings?: string[]
  hint?: string
  confirmation?: string | null
  children: React.ReactNode
}

function Field({ label, field, errors, warnings = [], hint, confirmation, children }: FieldProps): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor={field}>{label}</label>
      <div className="field__input">
        {children}
        {confirmation && <span className="field__confirmation">{confirmation}</span>}
      </div>
      <div id={`${field}-messages`} className="field__messages" aria-live="polite">
        {hint && <p className="message message--hint">{hint}</p>}
        {errors.map((message) => (
          <p key={message} className="message message--error">
            {message}
          </p>
        ))}
        {warnings.map((message) => (
          <p key={message} className="message message--warning">
            ⚠ {message}
          </p>
        ))}
      </div>
    </div>
  )
}
