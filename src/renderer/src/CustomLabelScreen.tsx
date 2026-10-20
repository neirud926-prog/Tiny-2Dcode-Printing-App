import { useEffect, useMemo, useRef, useState } from 'react'
import { BUILT_IN_TEMPLATES, MAX_CODE_LENGTH, PLAIN_CHARACTERS_TEXT, type Symbology, type Template } from '../../core/template'
import type { PrintOutcome } from '../../preload/api'
import {
  buildCustomLabel,
  renderCustomLabelSvg,
  templateSizeProblem,
  type BuildCustomLabelResult,
  type CustomLabelField,
  type CustomLabelRequest
} from '../../render/customLabel'
import { formatLabelSizeMm, SMALL_LABEL, type LabelSizeEntry, type PcSettings } from '../../render/printSettings'
import { Field } from './LabelScreen'
import { LabelFrame } from './LabelPreview'
import { OutcomeMessage } from './OutcomeMessage'

const SYMBOLOGIES: readonly { value: Symbology; label: string }[] = [
  { value: 'datamatrix', label: 'DataMatrix' },
  { value: 'qr', label: 'QR' }
]

/** Text typed per Template line index; kept when switching Templates. */
type Lines = readonly string[]

function parseCopies(value: string): number {
  return /^[0-9]{1,3}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

interface CustomLabelScreenProps {
  /** This PC's settings: the Label Size loaded decides which Templates can print. */
  settings: PcSettings
}

/**
 * The Custom Label tab: a Template, DataMatrix or QR, the code data, the Template's fill-in lines and
 * copies on the left; the live preview and the data the code holds on the right. Stays mounted, so
 * what was typed is kept while the app is open.
 */
export function CustomLabelScreen({ settings }: CustomLabelScreenProps): React.JSX.Element {
  const [templates, setTemplates] = useState<readonly Template[]>(BUILT_IN_TEMPLATES)
  const [sizes, setSizes] = useState<readonly LabelSizeEntry[]>([SMALL_LABEL])
  const [templateId, setTemplateId] = useState(BUILT_IN_TEMPLATES[0].id)
  const [symbology, setSymbology] = useState<Symbology>('datamatrix')
  const [codeValue, setCodeValue] = useState('')
  const [lines, setLines] = useState<Lines>([])
  const [copies, setCopies] = useState('1')
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)
  const form = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let current = true
    void window.api.listTemplates().then((list) => current && list.ok && setTemplates(list.templates))
    void window.api.listLabelSizes().then((list) => current && list.ok && setSizes(list.sizes))
    return () => {
      current = false
    }
  }, [settings.labelSizeId])

  const template = templates.find((entry) => entry.id === templateId) ?? templates[0]
  const size = sizes.find((entry) => entry.id === template.labelSizeId) ?? SMALL_LABEL
  /** The Template's fill-in lines, with their index among all its lines ("Line N"). */
  const fillLines = template.texts.map((text, index) => ({ text, index })).filter(({ text }) => text.mode === 'fill')
  const codeIsFill = template.code.mode === 'fill'

  const request = useMemo<CustomLabelRequest>(
    () => ({ templateId: template.id, symbology, codeValue, texts: fillLines.map(({ index }) => lines[index] ?? ''), copies: parseCopies(copies) }),
    [template, symbology, codeValue, lines, copies] // fillLines follows the template
  )
  const result = useMemo<BuildCustomLabelResult>(() => buildCustomLabel(template, size, request), [template, size, request])
  const sizeProblem = templateSizeProblem(template, settings.labelSizeId, sizes)
  const svg = useMemo(() => (result.ok ? renderCustomLabelSvg(result.label) : null), [result])

  const errorsFor = (field: CustomLabelField, value: string): string[] =>
    result.ok || (!touched.has(field) && value === '') ? [] : result.errors.filter((error) => error.field === field).map((error) => error.message)
  const templateErrors = result.ok ? [] : result.errors.filter((error) => error.field === 'template').map((error) => error.message)

  function touch(field: string): void {
    setTouched((previous) => new Set([...previous, field]))
  }

  function changed(): void {
    setOutcome(null)
  }

  function setLine(index: number, value: string): void {
    setLines((previous) => {
      const next = [...previous]
      while (next.length < index) next.push('')
      next[index] = value
      return next
    })
    changed()
  }

  /** Enter moves to the next box (as on the GTIN Label form). */
  function onEnter(event: React.KeyboardEvent<HTMLInputElement>, field: string): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    touch(field)
    const inputs = [...(form.current?.querySelectorAll<HTMLInputElement>('input[type="text"]') ?? [])]
    const next = inputs[inputs.indexOf(event.currentTarget) + 1]
    next?.focus()
    next?.select()
  }

  async function print(): Promise<void> {
    if (!result.ok || sizeProblem || printing) return
    setPrinting(true)
    setOutcome(null)
    try {
      setOutcome(await window.api.printCustomLabel(request))
    } catch (error) {
      setOutcome({ ok: false, message: `Not printed: ${String(error)}` })
    } finally {
      setPrinting(false)
    }
  }

  const firstFill = fillLines[0]
  const codeErrors = errorsFor('code', codeValue)
  const copiesErrors = errorsFor('copies', copies)

  return (
    <main className="layout">
      <section className="panel form" aria-label="Custom Label details" ref={form}>
        <h2>Custom Label</h2>

        <div className="field">
          <label htmlFor="custom-template">Template</label>
          <select
            id="custom-template"
            value={template.id}
            onChange={(event) => {
              setTemplateId(event.target.value)
              changed()
            }}
          >
            {templates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <div className="field__messages" aria-live="polite">
            <p className="message message--hint">{templateHint(template, size)}</p>
            {sizeProblem && <p className="message message--error">{sizeProblem}</p>}
            {templateErrors.map((message) => (
              <p key={message} className="message message--error">
                {message}
              </p>
            ))}
          </div>
        </div>

        <fieldset className="field pack-volume">
          <legend>Code</legend>
          <div className="segmented segmented--two" role="radiogroup" aria-label="Code">
            {SYMBOLOGIES.map((choice) => (
              <label key={choice.value} className={symbology === choice.value ? 'segment segment--selected' : 'segment'}>
                <input
                  type="radio"
                  name="custom-symbology"
                  value={choice.value}
                  checked={symbology === choice.value}
                  onChange={() => {
                    setSymbology(choice.value)
                    changed()
                  }}
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>

        {codeIsFill && (
          <Field label="Code data" field="custom-code" errors={codeErrors} hint={`Up to ${MAX_CODE_LENGTH}: ${PLAIN_CHARACTERS_TEXT}`}>
            <input
              id="custom-code"
              type="text"
              className={codeErrors.length > 0 ? 'code invalid' : 'code'}
              value={codeValue}
              onChange={(event) => {
                setCodeValue(event.target.value)
                changed()
              }}
              onBlur={() => touch('code')}
              onKeyDown={(event) => onEnter(event, 'code')}
              aria-invalid={codeErrors.length > 0}
              aria-describedby="custom-code-messages"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}

        {fillLines.map(({ text, index }) => {
          const field: CustomLabelField = `line${index + 1}`
          const value = lines[index] ?? ''
          const errors = errorsFor(field, value)
          return (
            <Field
              key={text.id}
              label={`Line ${index + 1}`}
              field={`custom-${field}`}
              errors={errors}
              hint={text.maxLength === undefined ? 'May be empty' : `Up to ${text.maxLength}; may be empty`}
            >
              <input
                id={`custom-${field}`}
                type="text"
                className={errors.length > 0 ? 'code invalid' : 'code'}
                value={value}
                onChange={(event) => setLine(index, event.target.value)}
                onBlur={() => touch(field)}
                onKeyDown={(event) => onEnter(event, field)}
                aria-invalid={errors.length > 0}
                aria-describedby={`custom-${field}-messages`}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )
        })}
        {firstFill && codeIsFill && (
          <div className="field__buttons field__buttons--below">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                setLine(firstFill.index, codeValue)
                touch(`line${firstFill.index + 1}`)
              }}
            >
              Copy code data to line {firstFill.index + 1}
            </button>
          </div>
        )}

        <Field label="Copies" field="custom-copies" errors={copiesErrors} hint="1–99">
          <input
            id="custom-copies"
            type="text"
            className={copiesErrors.length > 0 ? 'copies invalid' : 'copies'}
            value={copies}
            onChange={(event) => {
              setCopies(event.target.value)
              changed()
            }}
            onBlur={() => touch('copies')}
            onKeyDown={(event) => onEnter(event, 'copies')}
            aria-invalid={copiesErrors.length > 0}
            aria-describedby="custom-copies-messages"
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>

        <div className="actions">
          <button type="button" className="print-button" disabled={!result.ok || sizeProblem !== null || printing} onClick={() => void print()}>
            {printing ? 'Printing…' : 'Print'}
          </button>
          {!result.ok && !outcome && <span className="actions__note">Complete the label to print.</span>}
        </div>
        <OutcomeMessage outcome={outcome} />
      </section>

      <section className="panel preview" aria-label="Label preview">
        <h2>Preview</h2>
        <LabelFrame svg={svg} size={size} />
        {result.ok ? (
          <p className="gs1-data" role="status">
            {result.label.symbology === 'qr' ? 'QR' : 'DataMatrix'} holds <code>{result.label.codeValue}</code>
          </p>
        ) : (
          <p className="self-check self-check--fail" role="status">
            ✗ Not printable: {result.errors.map((error) => error.message).join(' ')}
          </p>
        )}
      </section>
    </main>
  )
}

function templateHint(template: Template, size: LabelSizeEntry): string {
  return `${size.name} (${formatLabelSizeMm(size)}), ${template.texts.length} line${template.texts.length === 1 ? '' : 's'}${template.builtIn ? ', built in' : ''}`
}
