import { useEffect, useMemo, useRef, useState } from 'react'
import { BUILT_IN_TEMPLATES, MAX_CODE_LENGTH, MAX_TEMPLATE_NAME_LENGTH, PLAIN_CHARACTERS_TEXT, type Symbology, type Template } from '../../core/template'
import type { PrintOutcome, TemplateChangeOutcome } from '../../preload/api'
import {
  buildCustomLabel,
  renderCustomLabelSvg,
  templateSizeProblem,
  textMaxLength,
  type BuildCustomLabelResult,
  type CustomLabelField,
  type CustomLabelRequest
} from '../../render/customLabel'
import { formatLabelSizeMm, SMALL_LABEL, type LabelSizeEntry, type PcSettings } from '../../render/printSettings'
import { Field } from './LabelScreen'
import { LabelFrame } from './LabelPreview'
import { OutcomeMessage } from './OutcomeMessage'
import { TopupLabelScreen } from './TopupLabelScreen'
import { newTemplate, TemplateDesigner } from './TemplateDesigner'

const SYMBOLOGIES: readonly { value: Symbology; label: string }[] = [
  { value: 'datamatrix', label: 'DataMatrix' },
  { value: 'qr', label: 'QR' }
]

/** The Template picker's value for the built-in Topup layout, which is not a Template. */
const TOPUP_LAYOUT = 'topup'

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
 * The Custom Label tab: a Template (or the built-in Topup layout, `TopupLabelScreen`), DataMatrix or QR, the code data, the Template's fill-in lines and
 * copies on the left; the live preview and the data the code holds on the right. Stays mounted, so
 * what was typed is kept while the app is open.
 */
export function CustomLabelScreen({ settings }: CustomLabelScreenProps): React.JSX.Element {
  const [templates, setTemplates] = useState<readonly Template[]>(BUILT_IN_TEMPLATES)
  const [sizes, setSizes] = useState<readonly LabelSizeEntry[]>([SMALL_LABEL])
  const [templateId, setTemplateId] = useState(BUILT_IN_TEMPLATES[0].id)
  const [symbology, setSymbology] = useState<Symbology>('datamatrix')
  const [topupSymbology, setTopupSymbology] = useState<Symbology>(settings.topupSymbology ?? 'qr')
  const [codeValue, setCodeValue] = useState('')
  const [lines, setLines] = useState<Lines>([])
  const [copies, setCopies] = useState('1')
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)
  const form = useRef<HTMLElement | null>(null)

  /** The designer, open on this Template (a new one has id `''`). */
  const [designing, setDesigning] = useState<Template | null>(null)
  /** The Template dialog open: New (choose a Label Size), Copy, Rename or Delete. */
  const [action, setAction] = useState<TemplateAction | null>(null)
  const [templatesMessage, setTemplatesMessage] = useState<string | null>(null)

  async function refreshLists(): Promise<void> {
    const [list, sizeList] = await Promise.all([window.api.listTemplates(), window.api.listLabelSizes()])
    if (list.ok) setTemplates(list.templates)
    setTemplatesMessage(list.ok ? null : list.message)
    if (sizeList.ok) setSizes(sizeList.sizes)
  }

  useEffect(() => {
    void refreshLists()
  }, [settings.labelSizeId]) // refreshLists only sets this tab's state, which stays mounted

  /** After a Template change: the new list, and the Template changed selected. */
  function templatesChanged(outcome: Extract<TemplateChangeOutcome, { ok: true }>): void {
    setTemplates(outcome.templates)
    if (outcome.template) setTemplateId(outcome.template.id)
    setTemplatesMessage(outcome.warning)
    setAction(null)
    setDesigning(null)
    changed()
  }

  const template = templates.find((entry) => entry.id === templateId) ?? templates[0]
  const size = sizes.find((entry) => entry.id === template.labelSizeId) ?? SMALL_LABEL
  /** The Template's fill-in lines, with their index among all its lines ("Line N"). */
  const fillLines = template.texts.map((text, index) => ({ text, index })).filter(({ text }) => text.mode === 'fill')
  const codeIsFill = template.code.mode === 'fill'

  const request = useMemo<CustomLabelRequest>(
    () => ({ templateId: template.id, symbology, codeValue, texts: fillLines.map(({ index }) => lines[index] ?? ''), copies: parseCopies(copies) }),
    [template, symbology, codeValue, lines, copies] // fillLines follows the template
  )
  const result = useMemo<BuildCustomLabelResult>(() => buildCustomLabel(template, size, request, settings.printerResolution), [template, size, request, settings.printerResolution])
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

  const templateSelect = (
    <select
      id="custom-template"
      value={templateId === TOPUP_LAYOUT ? TOPUP_LAYOUT : template.id}
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
      <option value={TOPUP_LAYOUT}>Topup</option>
    </select>
  )

  if (templateId === TOPUP_LAYOUT && !designing) {
    return (
      <TopupLabelScreen
        settings={settings}
        symbology={topupSymbology}
        onSymbology={(choice) => {
          setTopupSymbology(choice)
          // Remembered for this PC; a failed save shows nothing.
          window.api.saveTopupSymbology(choice).catch(() => undefined)
        }}
        templatePicker={
          <div className="field">
            <label htmlFor="custom-template">Template</label>
            {templateSelect}
          </div>
        }
      />
    )
  }

  if (designing) {
    const designSize = sizes.find((entry) => entry.id === designing.labelSizeId) ?? SMALL_LABEL
    return <TemplateDesigner initial={designing} size={designSize} templates={templates} onSaved={templatesChanged} onCancel={() => setDesigning(null)} />
  }

  return (
    <main className="layout">
      <section className="panel form" aria-label="Custom Label details" ref={form}>
        <h2>Custom Label</h2>

        <div className="field">
          <label htmlFor="custom-template">Template</label>
          {templateSelect}
          <div className="field__messages" aria-live="polite">
            <p className="message message--hint">{templateHint(template, size)}</p>
            {sizeProblem && <p className="message message--error">{sizeProblem}</p>}
            {templateErrors.map((message) => (
              <p key={message} className="message message--error">
                {message}
              </p>
            ))}
            {templatesMessage && <p className="message message--warning">{templatesMessage}</p>}
          </div>
          <div className="template-actions">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                void refreshLists()
                setAction('new')
              }}
            >
              New template
            </button>
            <button type="button" className="button button--secondary button--small" onClick={() => setAction('copy')}>
              Copy
            </button>
            <button type="button" className="button button--secondary button--small" disabled={template.builtIn} onClick={() => setDesigning(template)}>
              Edit
            </button>
            <button type="button" className="button button--secondary button--small" disabled={template.builtIn} onClick={() => setAction('rename')}>
              Rename
            </button>
            <button type="button" className="button button--secondary button--small" disabled={template.builtIn} onClick={() => setAction('delete')}>
              Delete
            </button>
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
              hint={`Up to ${textMaxLength(text)}; may be empty`}
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
      {action && (
        <TemplateActionDialog
          action={action}
          template={template}
          sizes={sizes}
          onDone={templatesChanged}
          onDesign={(size) => {
            setAction(null)
            setDesigning(newTemplate(size))
          }}
          onClose={() => setAction(null)}
        />
      )}
    </main>
  )
}

type TemplateAction = 'new' | 'copy' | 'rename' | 'delete'

/** New: choose the Label Size to design for. Copy and Rename: the name. Delete: confirm. */
function TemplateActionDialog({
  action,
  template,
  sizes,
  onDone,
  onDesign,
  onClose
}: {
  action: TemplateAction
  template: Template
  sizes: readonly LabelSizeEntry[]
  onDone(outcome: Extract<TemplateChangeOutcome, { ok: true }>): void
  onDesign(size: LabelSizeEntry): void
  onClose(): void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(action === 'copy' ? `Copy of ${template.name}`.slice(0, MAX_TEMPLATE_NAME_LENGTH) : template.name)
  const [sizeId, setSizeId] = useState(template.labelSizeId)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  async function confirm(): Promise<void> {
    if (action === 'new') {
      const size = sizes.find((entry) => entry.id === sizeId)
      if (size) onDesign(size)
      return
    }
    setBusy(true)
    setRefused(null)
    try {
      const outcome =
        action === 'copy' ? await window.api.copyTemplate(template.id, name)
        : action === 'rename' ? await window.api.renameTemplate(template.id, name)
        : await window.api.deleteTemplate(template.id)
      if (outcome.ok) onDone(outcome)
      else setRefused(outcome.message)
    } catch (error) {
      setRefused(String(error))
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<TemplateAction, string> = {
    new: 'New template',
    copy: `Copy ${template.name}`,
    rename: `Rename ${template.name}`,
    delete: `Delete ${template.name}?`
  }
  const buttons: Record<TemplateAction, string> = { new: 'Design', copy: 'Copy', rename: 'Rename', delete: 'Delete' }
  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="template-action-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault()
          void confirm()
        }}
      >
        <h2 id="template-action-title" className="dialog__title">
          {titles[action]}
        </h2>
        {action === 'new' && (
          <div className="field">
            <label htmlFor="template-size">Label Size</label>
            <select id="template-size" value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
              {sizes.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.name} ({formatLabelSizeMm(size)})
                </option>
              ))}
            </select>
            <p className="message message--hint">A template prints only on the Label Size it is made for.</p>
          </div>
        )}
        {(action === 'copy' || action === 'rename') && (
          <div className="field">
            <label htmlFor="template-new-name">Name</label>
            <input id="template-new-name" type="text" value={name} maxLength={MAX_TEMPLATE_NAME_LENGTH} autoComplete="off" autoFocus onChange={(event) => setName(event.target.value)} />
          </div>
        )}
        {action === 'delete' && <p>The template is deleted for every PC. This cannot be undone.</p>}
        {refused && (
          <p className="message message--error dialog__still" role="alert">
            {refused}
          </p>
        )}
        <div className="dialog__footer template-actions">
          <button type="button" className="button button--secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {buttons[action]}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function templateHint(template: Template, size: LabelSizeEntry): string {
  return `${size.name} (${formatLabelSizeMm(size)}), ${template.texts.length} line${template.texts.length === 1 ? '' : 's'}${template.builtIn ? ', built in' : ''}`
}
