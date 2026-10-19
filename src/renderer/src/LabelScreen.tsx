import { useMemo, useRef, useState } from 'react'
import { formatExpiry, parseExpiry } from '../../core/expiry'
import { buildLabel, type FieldMessage, type LabelField, type LabelRequest } from '../../core/label'
import type { PrintOutcome } from '../../preload/api'
import type { PcSettings } from '../../render/printSettings'
import { AppHeader } from './AppHeader'
import { LabelPreview } from './LabelPreview'
import { OutcomeMessage } from './OutcomeMessage'
import { useToday } from './today'

type FormField = 'itemCode' | 'expiry' | 'lot' | 'copies'
type FormValues = Record<FormField, string>

/** Form order: Enter moves to the next field. */
const FORM_FIELDS: readonly FormField[] = ['itemCode', 'expiry', 'lot', 'copies']

/** A field's errors show once it has been left, or once its entry is complete enough to judge. */
const COMPLETE_LENGTH: Record<FormField, number> = { itemCode: 6, expiry: 8, lot: 1, copies: 1 }

const EMPTY_FORM: FormValues = { itemCode: '', expiry: '', lot: '', copies: '1' }

/** Upper-cases a–z as staff type (Caps Lock need not matter); the label core does the same. */
function upperCaseAscii(value: string): string {
  return value.replace(/[a-z]/g, (letter) => letter.toUpperCase())
}

function parseCopies(value: string): number {
  return /^[0-9]{1,3}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

interface LabelScreenProps {
  settings: PcSettings
  onOpenSettings(): void
  hidden?: boolean
}

/** The label screen: the form on the left, the live preview and self-check on the right. */
export function LabelScreen({ settings, onOpenSettings, hidden = false }: LabelScreenProps): React.JSX.Element {
  const today = useToday()
  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)
  const inputs = useRef<Partial<Record<FormField, HTMLInputElement | null>>>({})

  const request = useMemo<LabelRequest>(
    () => ({
      itemCode: values.itemCode,
      packVolumeDigit: 0, // Pack Volume is chosen once the Item List says which items are liquids.
      expiry: values.expiry,
      lot: values.lot,
      copies: parseCopies(values.copies)
    }),
    [values]
  )
  const result = useMemo(() => buildLabel(request, { today }), [request, today])

  const errors = result.ok ? [] : result.errors
  const messagesFor = (list: FieldMessage[], field: LabelField): string[] =>
    list.filter((message) => message.field === field).map((message) => message.message)
  const visibleErrors = (field: FormField): string[] =>
    touched.has(field) || values[field].trim().length >= COMPLETE_LENGTH[field] ? messagesFor(errors, field) : []

  const parsedExpiry = parseExpiry(values.expiry)
  const expiryConfirmation = parsedExpiry.ok ? formatExpiry(parsedExpiry.expiry) : null

  function touch(...fields: FormField[]): void {
    setTouched((previous) => new Set([...previous, ...fields]))
  }

  function change(field: FormField, value: string): void {
    setValues((previous) => ({ ...previous, [field]: field === 'itemCode' || field === 'lot' ? upperCaseAscii(value) : value }))
    setOutcome(null)
  }

  /** Sends the request (not the label): the main process rebuilds and self-checks it before printing. */
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
    const next = FORM_FIELDS[FORM_FIELDS.indexOf(field) + 1]
    if (next) {
      touch(field)
      inputs.current[next]?.focus()
      inputs.current[next]?.select()
    } else {
      touch(...FORM_FIELDS)
    }
  }

  function fieldProps(field: FormField, className: string) {
    const invalid = visibleErrors(field).length > 0
    return {
      id: field,
      ref: (element: HTMLInputElement | null) => {
        inputs.current[field] = element
      },
      value: values[field],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(field, event.target.value),
      onBlur: () => touch(field),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => handleKeyDown(field, event),
      'aria-invalid': invalid,
      'aria-describedby': `${field}-messages`,
      autoComplete: 'off',
      spellCheck: false,
      className: invalid ? `${className} invalid` : className
    }
  }

  return (
    <div className="screen" hidden={hidden}>
      <AppHeader>
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

          <Field label="Item Code" field="itemCode" errors={visibleErrors('itemCode')} hint="6 characters, e.g. PARA01">
            <input {...fieldProps('itemCode', 'code')} autoFocus />
          </Field>

          <Field
            label="Expiry"
            field="expiry"
            errors={visibleErrors('expiry')}
            warnings={messagesFor(result.warnings, 'expiry')}
            hint="Month-only pack? Enter day 01"
            confirmation={visibleErrors('expiry').length === 0 ? expiryConfirmation : null}
          >
            <input {...fieldProps('expiry', 'code')} inputMode="numeric" placeholder="ddmmyyyy" />
          </Field>

          <Field label="Lot" field="lot" errors={visibleErrors('lot')} hint='A–Z, 0–9, "-", "/", "(" and ")"; up to 20'>
            <input {...fieldProps('lot', 'code')} />
          </Field>

          <Field label="Copies" field="copies" errors={visibleErrors('copies')} hint="1–99">
            <input {...fieldProps('copies', 'copies')} inputMode="numeric" />
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
