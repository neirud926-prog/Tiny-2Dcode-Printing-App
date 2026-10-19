import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PrinterChoice, PrintOutcome } from '../../preload/api'
import { DOT_MM } from '../../render/dataMatrix'
import {
  DEFAULT_PC_SETTINGS,
  MAX_OFFSET_MM,
  normalisePcSettings,
  offsetInDots,
  snapToPrinterDots,
  type PcSettings,
  type PcSettingsField
} from '../../render/printSettings'
import { AppHeader } from './AppHeader'
import { OutcomeMessage } from './OutcomeMessage'

type NumberField = 'widthMm' | 'heightMm' | 'offsetXmm' | 'offsetYmm'

interface PrinterSettingsScreenProps {
  /** `setup`: the Setup step "Printer" on a PC with no settings. `settings`: changing them later. */
  mode: 'setup' | 'settings'
  pcName: string
  defaultLogFolder: string
  initial?: PcSettings
  /** Why earlier settings were not used, shown on the Setup step. */
  notice?: string | null
  onSaved(settings: PcSettings): void
  onCancel?(): void
  /** More Settings sections, shown below the printer settings (e.g. the Item List). */
  children?: React.ReactNode
}

/** A label printer driver name is likely to contain one of these. */
const LABEL_PRINTER_PATTERN = /zebra|zdesigner|gx420/i

/** The Setup step "Printer" and the Settings screen: printer, label size, offsets, test print. */
export function PrinterSettingsScreen({
  mode,
  pcName,
  defaultLogFolder,
  initial = DEFAULT_PC_SETTINGS,
  notice = null,
  onSaved,
  onCancel,
  children
}: PrinterSettingsScreenProps): React.JSX.Element {
  const [printers, setPrinters] = useState<PrinterChoice[] | null>(null)
  const [printerName, setPrinterName] = useState(initial.printerName)
  const [numbers, setNumbers] = useState<Record<NumberField, string>>({
    widthMm: String(initial.labelSize.widthMm),
    heightMm: String(initial.labelSize.heightMm),
    offsetXmm: formatMm(initial.offsetXmm),
    offsetYmm: formatMm(initial.offsetYmm)
  })
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

  const candidate = {
    printerName,
    labelSize: { widthMm: parseMm(numbers.widthMm), heightMm: parseMm(numbers.heightMm) },
    offsetXmm: parseMm(numbers.offsetXmm),
    offsetYmm: parseMm(numbers.offsetYmm),
    logFolder
  }
  const validation = normalisePcSettings(candidate)
  const errorsFor = (field: PcSettingsField): string[] =>
    !validation.ok && touched.has(field) ? validation.errors.filter((error) => error.field === field).map((error) => error.message) : []

  const printerMissing = printers !== null && printerName !== '' && !printers.some((printer) => printer.name === printerName)
  const printerOptions = useMemo(
    () => (printerMissing ? [{ name: printerName, displayName: `${printerName} (not installed)` }, ...(printers ?? [])] : (printers ?? [])),
    [printerMissing, printerName, printers]
  )

  function touchAll(): void {
    setTouched(new Set<PcSettingsField>(['printerName', 'widthMm', 'heightMm', 'offsetXmm', 'offsetYmm', 'logFolder']))
  }

  function changeNumber(field: NumberField, value: string): void {
    setNumbers((previous) => ({ ...previous, [field]: value }))
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
      if (result.ok) onSaved(result.settings)
      else setOutcome(result)
    } catch (error) {
      setOutcome({ ok: false, message: `The settings could not be saved: ${String(error)}` })
    } finally {
      setBusy(null)
    }
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
  function offsetConfirmation(field: 'offsetXmm' | 'offsetYmm'): string | null {
    const typed = candidate[field]
    if (!Number.isFinite(typed) || Math.abs(typed) > MAX_OFFSET_MM) return null
    const value = snapToPrinterDots(typed)
    const dots = offsetInDots(value)
    return `${dots} dot${Math.abs(dots) === 1 ? '' : 's'} = ${formatMm(value)} mm`
  }

  return (
    <div className="screen">
      <AppHeader>
        <span className="header-info">PC {pcName}</span>
      </AppHeader>

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

          <fieldset className="field-group">
            <legend>Label size</legend>
            <div className="field-row">
              <NumberInput field="widthMm" label="Width" unit="mm" value={numbers.widthMm} errors={errorsFor('widthMm')} onChange={changeNumber} onBlur={touch} />
              <NumberInput field="heightMm" label="Height" unit="mm" value={numbers.heightMm} errors={errorsFor('heightMm')} onChange={changeNumber} onBlur={touch} />
            </div>
            <p className="message message--hint">Default 34.4 × 25 mm (Zebra GX420t roll).</p>
          </fieldset>

          <fieldset className="field-group">
            <legend>Offsets</legend>
            <div className="field-row">
              <NumberInput
                field="offsetXmm"
                label="X (right)"
                unit="mm"
                value={numbers.offsetXmm}
                errors={errorsFor('offsetXmm')}
                confirmation={offsetConfirmation('offsetXmm')}
                onChange={changeNumber}
                onBlur={touch}
              />
              <NumberInput
                field="offsetYmm"
                label="Y (down)"
                unit="mm"
                value={numbers.offsetYmm}
                errors={errorsFor('offsetYmm')}
                confirmation={offsetConfirmation('offsetYmm')}
                onChange={changeNumber}
                onBlur={touch}
              />
            </div>
            <p className="message message--hint">
              Moves the print if it is off-centre on the label; negative moves left or up. Rounded to whole printer dots ({DOT_MM.toFixed(3)} mm).
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
            {onCancel && (
              <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy !== null}>
                Cancel
              </button>
            )}
          </div>
          <OutcomeMessage outcome={outcome} />
        </section>
        {children}
      </main>
    </div>
  )

  function touch(field: PcSettingsField): void {
    setTouched((previous) => new Set([...previous, field]))
  }
}

interface NumberInputProps {
  field: NumberField
  label: string
  unit: string
  value: string
  errors: string[]
  confirmation?: string | null
  onChange(field: NumberField, value: string): void
  onBlur(field: NumberField): void
}

function NumberInput({ field, label, unit, value, errors, confirmation, onChange, onBlur }: NumberInputProps): React.JSX.Element {
  const invalid = errors.length > 0
  return (
    <div className="field field--number">
      <label htmlFor={field}>{label}</label>
      <div className="field__input">
        <input
          id={field}
          className={invalid ? 'number invalid' : 'number'}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-invalid={invalid}
          aria-describedby={`${field}-messages`}
          onChange={(event) => onChange(field, event.target.value)}
          onBlur={() => onBlur(field)}
        />
        <span className="field__unit">{unit}</span>
      </div>
      <div id={`${field}-messages`} className="field__messages" aria-live="polite">
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

function formatMm(value: number): string {
  return String(Number(value.toFixed(3)))
}
