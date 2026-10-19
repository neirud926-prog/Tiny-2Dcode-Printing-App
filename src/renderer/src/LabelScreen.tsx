import { useEffect, useMemo, useRef, useState } from 'react'
import { formatExpiry, parseExpiry } from '../../core/expiry'
import { encodeInternalGtin, PACK_VOLUMES, type PackVolumeDigit } from '../../core/internalGtin'
import { describeItemList, formatFileDate, isLiquid, itemListProblems, type ItemListEntry, type ItemListInfo } from '../../core/itemList'
import { buildLabel, type BuildLabelResult, type FieldMessage, type LabelField, type LabelRequest } from '../../core/label'
import { itemCodeFromScan, type ScanSource } from '../../core/scanInput'
import type { ItemLookup, PrintOutcome } from '../../preload/api'
import type { PcSettings } from '../../render/printSettings'
import { AppHeader } from './AppHeader'
import { LabelPreview } from './LabelPreview'
import { OutcomeMessage } from './OutcomeMessage'
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

/** The Pack Volume choices for a liquid, in mL: the listed volumes, then Other (digit 0, no volume encoded). */
const PACK_VOLUME_CHOICES: readonly { digit: PackVolumeDigit; label: string; name: string }[] = [
  ...PACK_VOLUMES.filter((entry) => entry.ml !== null).map((entry) => ({ digit: entry.digit, label: String(entry.ml), name: `${entry.ml} mL` })),
  { digit: 0, label: 'Other', name: 'Other volume' }
]

const LOOKUP_PENDING = 'Press Enter to look up this Item Code in the Item List.'
const LOOKUP_RUNNING = 'Looking up the Item Code…'
const CHOOSE_PACK_VOLUME = 'Choose the Pack Volume.'

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
  onOpenSettings(): void
  hidden?: boolean
}

/** The label screen: the form on the left, the live preview and self-check on the right. */
export function LabelScreen({ settings, itemList, onItemListChanged, onOpenSettings, hidden = false }: LabelScreenProps): React.JSX.Element {
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
  const inputs = useRef<Partial<Record<FormField, HTMLInputElement | null>>>({})
  const packVolumeGroup = useRef<HTMLDivElement | null>(null)

  const stamp = itemList.importedAt
  /** The lookup for the Item Code as it is now, against the Item List in use. */
  const currentLookup = lookup && lookup.code === values.itemCode && lookup.stamp === stamp ? lookup : null
  const item = currentLookup?.status === 'found' ? currentLookup.item : null
  const liquid = item !== null && isLiquid(item)

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

  // A newer Item List came into use (from Settings or another PC): look the Item Code up again in it.
  useEffect(() => {
    const previous = lookupRef.current
    if (previous && previous.status !== 'checking' && previous.code === itemCodeRef.current && previous.stamp !== stamp) {
      void checkItemCode(previous.code, 'never')
    }
  }, [stamp]) // Runs only when the Item List changes; checkItemCode reads refs, not this render's state.

  useEffect(() => {
    if (pendingFocus === null || unknownDialogFor !== null) return
    if (pendingFocus === 'packVolume') {
      const group = packVolumeGroup.current
      ;(group?.querySelector<HTMLInputElement>('input:checked') ?? group?.querySelector<HTMLInputElement>('input'))?.focus()
    } else {
      focusField(pendingFocus)
    }
    setPendingFocus(null)
  }, [pendingFocus, unknownDialogFor])

  function touch(...fields: TouchField[]): void {
    setTouched((previous) => new Set([...previous, ...fields]))
  }

  function change(field: FormField, value: string): void {
    const next = field === 'itemCode' || field === 'lot' ? upperCaseAscii(value) : value
    if (field === 'itemCode' && next !== values.itemCode) {
      setScan(null)
      setPackVolume(null)
      setTouched((previous) => new Set([...previous].filter((name) => name !== 'packVolume')))
    }
    setValues((previous) => ({ ...previous, [field]: next }))
    setOutcome(null)
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
    <div className="screen" hidden={hidden}>
      <AppHeader>
        <span className="header-info" title={describeItemList(itemList)}>
          Item List <strong>{formatFileDate(itemList.sourceModified)}</strong>
        </span>
        <span className="header-info">
          Printer <strong>{settings.printerName}</strong>
        </span>
        <button type="button" className="button button--secondary button--small" onClick={onOpenSettings}>
          Settings
        </button>
      </AppHeader>

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
                        focusField('expiry')
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

          <Field
            label="Expiry"
            field="expiry"
            errors={visibleErrors('expiry')}
            warnings={messagesFor(result.warnings, 'expiry')}
            hint="Month-only pack? Enter day 01"
            confirmation={visibleErrors('expiry').length === 0 ? expiryConfirmation : null}
          >
            <input
              {...fieldProps('expiry', 'code', visibleErrors('expiry').length > 0)}
              onFocus={() => liquid && touch('packVolume')}
              inputMode="numeric"
              placeholder="ddmmyyyy"
            />
          </Field>

          <Field label="Lot" field="lot" errors={visibleErrors('lot')} hint='A–Z, 0–9, "-", "/", "(" and ")"; up to 20'>
            <input {...fieldProps('lot', 'code', visibleErrors('lot').length > 0)} />
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
          onClose={() => {
            setUnknownDialogFor(null)
            touch('itemCode')
            setPendingFocus('itemCode')
          }}
        />
      )}
    </div>
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
