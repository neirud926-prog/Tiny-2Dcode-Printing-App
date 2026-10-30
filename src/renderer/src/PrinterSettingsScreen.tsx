import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LabelSizesList, NewLabelSize, PrinterChoice, PrintOutcome } from '../../preload/api'
import { DOT_MM } from '../../render/dataMatrix'
import {
  DEFAULT_PC_SETTINGS,
  formatLabelSizeMm,
  MAX_OFFSET_MM,
  normaliseLabelSize,
  normalisePcSettings,
  offsetInDots,
  offsetsFor,
  SMALL_LABEL,
  snapToPrinterDots,
  type LabelSizeEntry,
  type LabelSizeField,
  type LabelSizeKind,
  type PcSettings,
  type PcSettingsField
} from '../../render/printSettings'
import { TAPE_WIDTHS_MM, tapeSizeName } from '../../render/tapeSize'
import { AppHeader } from './AppHeader'
import { OutcomeMessage } from './OutcomeMessage'

type OffsetField = 'offsetXmm' | 'offsetYmm'
type OffsetTexts = Record<OffsetField, string>

interface PrinterSettingsScreenProps {
  /** `setup`: the Setup step "Printer" on a PC with no settings. `settings`: changing them later. */
  mode: 'setup' | 'settings'
  pcName: string
  defaultLogFolder: string
  initial?: PcSettings
  /** Why earlier settings were not used, shown on the Setup step. */
  notice?: string | null
  onSaved(settings: PcSettings): void
  /** More Settings sections, shown below the printer settings (e.g. the Item List). */
  children?: React.ReactNode
}

/** A label printer driver name is likely to contain one of these. */
const LABEL_PRINTER_PATTERN = /zebra|zdesigner|gx420/i

/** The Setup step "Printer" and the Settings tab: printer, the label loaded in it and its offsets, test print; Label Sizes in Settings. */
export function PrinterSettingsScreen({
  mode,
  pcName,
  defaultLogFolder,
  initial = DEFAULT_PC_SETTINGS,
  notice = null,
  onSaved,
  children
}: PrinterSettingsScreenProps): React.JSX.Element {
  const [printers, setPrinters] = useState<PrinterChoice[] | null>(null)
  const [printerName, setPrinterName] = useState(initial.printerName)
  const [sizes, setSizes] = useState<readonly LabelSizeEntry[]>([SMALL_LABEL])
  const [sizesMessage, setSizesMessage] = useState<string | null>(null)
  const [labelSizeId, setLabelSizeId] = useState(initial.labelSizeId)
  /** The offsets typed for each Label Size, kept while another size is chosen. */
  const [offsetTexts, setOffsetTexts] = useState<Record<string, OffsetTexts>>(() => offsetTextsFrom(initial))
  const [logFolder, setLogFolder] = useState(initial.logFolder)
  const [touched, setTouched] = useState<ReadonlySet<PcSettingsField>>(new Set())
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)

  const loadPrinters = useCallback(async () => {
    setPrinters(null)
    let list: PrinterChoice[] = []
    try {
      list = await window.api.listPrinters()
    } catch (error) {
      setOutcome({ ok: false, message: `The list of printers could not be read: ${String(error)}` })
    }
    setPrinters(list)
    // On a new PC, start from the label printer if there is an obvious one.
    setPrinterName((current) => current || (list.find((printer) => LABEL_PRINTER_PATTERN.test(`${printer.name} ${printer.displayName}`))?.name ?? ''))
  }, [])

  useEffect(() => {
    void loadPrinters()
  }, [loadPrinters])

  useEffect(() => {
    void window.api.listLabelSizes().then(showSizes, (error: unknown) => setSizesMessage(`The Label Sizes could not be read: ${String(error)}`))
  }, [])

  function showSizes(list: LabelSizesList): void {
    if (list.ok) {
      setSizes(list.sizes)
      setSizesMessage(null)
    } else setSizesMessage(list.message)
  }

  const texts = offsetTexts[labelSizeId] ?? offsetTextsOf(initial, labelSizeId)
  const candidate = {
    printerName,
    labelSizeId,
    offsets: Object.fromEntries(
      Object.entries({ ...offsetTexts, [labelSizeId]: texts }).map(([id, typed]) => [id, { offsetXmm: parseMm(typed.offsetXmm), offsetYmm: parseMm(typed.offsetYmm) }])
    ),
    logFolder
  }
  const validation = normalisePcSettings(candidate)
  const errorsFor = (field: PcSettingsField): string[] =>
    !validation.ok && touched.has(field) ? validation.errors.filter((error) => error.field === field).map((error) => error.message) : []

  const printerMissing = printers !== null && printerName !== '' && !printers.some((printer) => printer.name === printerName)
  const sizeMissing = !sizes.some((size) => size.id === labelSizeId)
  const printerOptions = useMemo(
    () => (printerMissing ? [{ name: printerName, displayName: `${printerName} (not installed)` }, ...(printers ?? [])] : (printers ?? [])),
    [printerMissing, printerName, printers]
  )

  function touchAll(): void {
    setTouched(new Set<PcSettingsField>(['printerName', 'labelSizeId', 'offsetXmm', 'offsetYmm', 'logFolder']))
  }

  function changeOffset(field: OffsetField, value: string): void {
    setOffsetTexts((previous) => ({ ...previous, [labelSizeId]: { ...texts, [field]: value } }))
    setOutcome(null)
  }

  /** Loads another size: its own offsets come back. Offsets left half-typed go back to the saved ones. */
  function chooseSize(id: string): void {
    const valid = (typed: string): boolean => Number.isFinite(parseMm(typed)) && Math.abs(parseMm(typed)) <= MAX_OFFSET_MM
    if (!valid(texts.offsetXmm) || !valid(texts.offsetYmm)) setOffsetTexts((previous) => ({ ...previous, [labelSizeId]: offsetTextsOf(initial, labelSizeId) }))
    setLabelSizeId(id)
    setOutcome(null)
  }

  async function testPrint(): Promise<void> {
    touchAll()
    if (!validation.ok) return
    setBusy('test')
    setOutcome(null)
    try {
      setOutcome(await window.api.testPrint(validation.settings))
    } catch (error) {
      setOutcome({ ok: false, message: `Test print failed: ${String(error)}` })
    } finally {
      setBusy(null)
    }
  }

  async function save(): Promise<void> {
    touchAll()
    if (!validation.ok) return
    setBusy('save')
    setOutcome(null)
    try {
      const result = await window.api.savePrinterSettings(validation.settings)
      if (result.ok) {
        onSaved(result.settings)
        if (mode === 'settings') setOutcome({ ok: true, message: 'Settings saved.', warning: null })
      } else setOutcome(result)
    } catch (error) {
      setOutcome({ ok: false, message: `The settings could not be saved: ${String(error)}` })
    } finally {
      setBusy(null)
    }
  }

  /** Settings tab: back to the saved settings. */
  function revert(): void {
    setPrinterName(initial.printerName)
    setLabelSizeId(initial.labelSizeId)
    setOffsetTexts(offsetTextsFrom(initial))
    setLogFolder(initial.logFolder)
    setTouched(new Set())
    setOutcome(null)
  }

  async function chooseLogFolder(): Promise<void> {
    try {
      const folder = await window.api.chooseLogFolder()
      if (folder) setLogFolder(folder)
    } catch (error) {
      setOutcome({ ok: false, message: `The log folder could not be chosen: ${String(error)}` })
    }
  }

  /** What an offset becomes once rounded to whole printer dots. */
  function offsetConfirmation(field: OffsetField): string | null {
    const typed = parseMm(texts[field])
    if (!Number.isFinite(typed) || Math.abs(typed) > MAX_OFFSET_MM) return null
    const value = snapToPrinterDots(typed)
    const dots = offsetInDots(value)
    return `${dots} dot${Math.abs(dots) === 1 ? '' : 's'} = ${formatMm(value)} mm`
  }

  const content = (
      <main className="settings-layout">
        <section className="panel settings" aria-label="Printer settings">
          <h2>{mode === 'setup' ? 'Setup: Printer' : 'Printer settings'}</h2>
          <p className="settings__intro">
            {mode === 'setup'
              ? `Choose this PC's label printer and label size, then do a test print. These settings are kept for ${pcName} only.`
              : `Settings for ${pcName} only. Other PCs keep their own.`}
          </p>
          {notice && (
            <p className="message message--warning settings__notice" role="alert">
              ⚠ {notice}
            </p>
          )}

          <div className="field">
            <label htmlFor="printerName">Printer</label>
            <div className="field__input">
              <select
                id="printerName"
                value={printerName}
                disabled={printers === null}
                onChange={(event) => {
                  setPrinterName(event.target.value)
                  setTouched((previous) => new Set([...previous, 'printerName']))
                  setOutcome(null)
                }}
                className={errorsFor('printerName').length > 0 || printerMissing ? 'invalid' : undefined}
              >
                <option value="">{printers === null ? 'Looking for printers…' : 'Choose a printer'}</option>
                {printerOptions.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
              <button type="button" className="button button--secondary" onClick={() => void loadPrinters()} disabled={printers === null}>
                Refresh
              </button>
            </div>
            <div className="field__messages" aria-live="polite">
              {printers !== null && printers.length === 0 && (
                <p className="message message--error">No printers are installed on this PC. Install the label printer in Windows, then press Refresh.</p>
              )}
              {printerMissing && <p className="message message--error">This printer is not installed on this PC. Choose another printer.</p>}
              {errorsFor('printerName').map((message) => (
                <p key={message} className="message message--error">
                  {message}
                </p>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="labelSizeId">Label in this printer</label>
            <div className="field__input">
              <select
                id="labelSizeId"
                value={labelSizeId}
                onChange={(event) => chooseSize(event.target.value)}
                className={sizeMissing ? 'invalid' : undefined}
              >
                {sizeMissing && <option value={labelSizeId}>(no longer in the list)</option>}
                {sizes.map((size) => (
                  <option key={size.id} value={size.id}>
                    {labelSizeText(size)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field__messages" aria-live="polite">
              {sizeMissing && <p className="message message--error">This label size is no longer in the list. Choose the label in this printer.</p>}
              {!sizeMissing && labelSizeId !== SMALL_LABEL.id && (
                <p className="message message--warning">GTIN Labels print only on the Small Label ({formatLabelSizeMm(SMALL_LABEL)}).</p>
              )}
              {mode === 'setup' && sizesMessage && <p className="message message--error">{sizesMessage}</p>}
            </div>
          </div>

          <fieldset className="field-group">
            <legend>Offsets for this label</legend>
            <div className="field-row">
              <NumberInput
                field="offsetXmm"
                label="X (right)"
                unit="mm"
                value={texts.offsetXmm}
                errors={errorsFor('offsetXmm')}
                confirmation={offsetConfirmation('offsetXmm')}
                onChange={changeOffset}
                onBlur={touch}
              />
              <NumberInput
                field="offsetYmm"
                label="Y (down)"
                unit="mm"
                value={texts.offsetYmm}
                errors={errorsFor('offsetYmm')}
                confirmation={offsetConfirmation('offsetYmm')}
                onChange={changeOffset}
                onBlur={touch}
              />
            </div>
            <p className="message message--hint">
              Moves the print if it is off-centre on the label; negative moves left or up. Rounded to whole printer dots ({DOT_MM.toFixed(3)} mm). Kept
              for each label size.
            </p>
          </fieldset>

          {mode === 'settings' && (
            <div className="field">
              <span className="field__label">Log folder</span>
              <div className="field__input">
                <code className="folder-path">{logFolder ?? defaultLogFolder}</code>
                {logFolder === null && <span className="field__note">default</span>}
              </div>
              <div className="field__input field__buttons">
                <button type="button" className="button button--secondary" onClick={() => void chooseLogFolder()}>
                  Change…
                </button>
                {logFolder !== null && (
                  <button type="button" className="button button--secondary" onClick={() => setLogFolder(null)}>
                    Use default
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="actions">
            <button type="button" className="button button--secondary" onClick={() => void testPrint()} disabled={busy !== null}>
              {busy === 'test' ? 'Printing…' : 'Test print'}
            </button>
            <button type="button" className="button button--primary" onClick={() => void save()} disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            {mode === 'settings' && (
              <button type="button" className="button button--secondary" onClick={revert} disabled={busy !== null}>
                Revert
              </button>
            )}
          </div>
          <OutcomeMessage outcome={outcome} />
        </section>
        {mode === 'settings' && <LabelSizesPanel sizes={sizes} message={sizesMessage} onChanged={showSizes} />}
        {children}
      </main>
  )
  if (mode === 'settings') return content
  return (
    <div className="screen">
      <AppHeader>
        <span className="header-info">PC {pcName}</span>
      </AppHeader>
      {content}
    </div>
  )

  function touch(field: PcSettingsField): void {
    setTouched((previous) => new Set([...previous, field]))
  }
}

type NewSizeTexts = Record<LabelSizeField, string>
const NO_NEW_SIZE: NewSizeTexts = { name: '', widthMm: '', heightMm: '', tapeWidthMm: '24', lengthMm: '' }

/** The Label Sizes shared by every PC: the Small Label first, others added and deleted here. */
function LabelSizesPanel({
  sizes,
  message,
  onChanged
}: {
  sizes: readonly LabelSizeEntry[]
  message: string | null
  onChanged(list: LabelSizesList): void
}): React.JSX.Element {
  const [kind, setKind] = useState<LabelSizeKind>('label')
  const [typed, setTyped] = useState<NewSizeTexts>(NO_NEW_SIZE)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const input: NewLabelSize =
    kind === 'tape'
      ? { kind, name: typed.name, tapeWidthMm: Number(typed.tapeWidthMm), lengthMm: parseMm(typed.lengthMm) }
      : { kind, name: typed.name, widthMm: parseMm(typed.widthMm), heightMm: parseMm(typed.heightMm) }
  const checked = normaliseLabelSize(input)
  const errorsFor = (field: LabelSizeField): string[] =>
    !checked.ok && tried ? checked.errors.filter((error) => error.field === field).map((error) => error.message) : []

  async function run(change: () => Promise<LabelSizesList>): Promise<boolean> {
    setBusy(true)
    setRefused(null)
    try {
      const list = await change()
      if (list.ok) onChanged(list)
      else setRefused(list.message)
      return list.ok
    } catch (error) {
      setRefused(String(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(): Promise<void> {
    setTried(true)
    if (!checked.ok) return
    if (await run(() => window.api.addLabelSize(input))) {
      setTyped(NO_NEW_SIZE)
      setTried(false)
    }
  }

  function change(field: LabelSizeField, value: string): void {
    setTyped((previous) => ({ ...previous, [field]: value }))
    setRefused(null)
  }

  return (
    <section className="panel settings" aria-label="Label Sizes">
      <h2>Label Sizes</h2>
      <p className="settings__intro">Label rolls and tape, shared by every PC. The Small Label is built in.</p>
      {message && <p className="message message--error">{message}</p>}
      <ul className="label-sizes">
        {sizes.map((size) => (
          <li key={size.id} className="label-sizes__row">
            <span>
              <strong>{size.name}</strong> <span className="field__note">{formatLabelSizeMm(size)}</span>
            </span>
            {size.id === SMALL_LABEL.id ? (
              <span className="field__note">built in</span>
            ) : (
              <button type="button" className="button button--secondary button--small" disabled={busy} onClick={() => void run(() => window.api.deleteLabelSize(size.id))}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      <fieldset className="field-group">
        <legend>Add a label size</legend>
        <div className="field" role="radiogroup" aria-label="Kind">
          <span className="field__label">Kind</span>
          <div className="field__input">
            {(['label', 'tape'] as const).map((each) => (
              <label key={each}>
                <input type="radio" name="newSizeKind" checked={kind === each} onChange={() => setKind(each)} /> {each === 'label' ? 'Label' : 'Tape'}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="newSizeName">Name</label>
          <div className="field__input">
            <input
              id="newSizeName"
              value={typed.name}
              autoComplete="off"
              placeholder={kind === 'tape' && checked.ok ? tapeSizeName(checked.size.heightMm, checked.size.widthMm) : undefined}
              onChange={(event) => change('name', event.target.value)}
            />
          </div>
          <div className="field__messages" aria-live="polite">
            {errorsFor('name').map((text) => (
              <p key={text} className="message message--error">
                {text}
              </p>
            ))}
          </div>
        </div>
        {kind === 'tape' ? (
          <div className="field-row">
            <div className="field">
              <label htmlFor="newTapeWidth">Tape width</label>
              <div className="field__input">
                <select id="newTapeWidth" value={typed.tapeWidthMm} onChange={(event) => change('tapeWidthMm', event.target.value)}>
                  {TAPE_WIDTHS_MM.map((width) => (
                    <option key={width} value={String(width)}>
                      {width} mm
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <NumberInput field="lengthMm" id="newTapeLength" label="Length" unit="mm" value={typed.lengthMm} errors={errorsFor('lengthMm')} onChange={change} onBlur={() => undefined} />
          </div>
        ) : (
          <div className="field-row">
            <NumberInput field="widthMm" id="newSizeWidth" label="Width" unit="mm" value={typed.widthMm} errors={errorsFor('widthMm')} onChange={change} onBlur={() => undefined} />
            <NumberInput field="heightMm" id="newSizeHeight" label="Height" unit="mm" value={typed.heightMm} errors={errorsFor('heightMm')} onChange={change} onBlur={() => undefined} />
          </div>
        )}
      </fieldset>
      <div className="actions">
        <button type="button" className="button button--secondary" disabled={busy} onClick={() => void add()}>
          Add
        </button>
      </div>
      {refused && <p className="message message--error" role="alert">{refused}</p>}
    </section>
  )
}

interface NumberInputProps<F extends string> {
  field: F
  /** The input's element id; the field name if not given. */
  id?: string
  label: string
  unit: string
  value: string
  errors: string[]
  confirmation?: string | null
  onChange(field: F, value: string): void
  onBlur(field: F): void
}

function NumberInput<F extends string>({ field, id = field, label, unit, value, errors, confirmation, onChange, onBlur }: NumberInputProps<F>): React.JSX.Element {
  const invalid = errors.length > 0
  return (
    <div className="field field--number">
      <label htmlFor={id}>{label}</label>
      <div className="field__input">
        <input
          id={id}
          className={invalid ? 'number invalid' : 'number'}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-invalid={invalid}
          aria-describedby={`${id}-messages`}
          onChange={(event) => onChange(field, event.target.value)}
          onBlur={() => onBlur(field)}
        />
        <span className="field__unit">{unit}</span>
      </div>
      <div id={`${id}-messages`} className="field__messages" aria-live="polite">
        {!invalid && confirmation && <p className="message message--hint">{confirmation}</p>}
        {errors.map((message) => (
          <p key={message} className="message message--error">
            {message}
          </p>
        ))}
      </div>
    </div>
  )
}

/** A decimal number typed in mm; NaN unless it is plainly a number. */
function parseMm(value: string): number {
  const trimmed = value.trim()
  return /^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

function offsetTextsOf(settings: PcSettings, labelSizeId: string): OffsetTexts {
  const offsets = offsetsFor(settings, labelSizeId)
  return { offsetXmm: formatMm(offsets.offsetXmm), offsetYmm: formatMm(offsets.offsetYmm) }
}

function offsetTextsFrom(settings: PcSettings): Record<string, OffsetTexts> {
  return Object.fromEntries(Object.keys(settings.offsets).map((id) => [id, offsetTextsOf(settings, id)]))
}

/** e.g. `Small Label (34.4 × 25 mm)`. */
function labelSizeText(size: LabelSizeEntry): string {
  return `${size.name} (${formatLabelSizeMm(size)})`
}

function formatMm(value: number): string {
  return String(Number(value.toFixed(3)))
}
