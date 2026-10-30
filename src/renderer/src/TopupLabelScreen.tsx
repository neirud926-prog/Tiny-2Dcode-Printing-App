import { useEffect, useMemo, useRef, useState } from 'react'
import type { Symbology } from '../../core/template'
import type { PrintOutcome, TopupLookup } from '../../preload/api'
import { formatLabelSizeMm, TOPUP_TAPE_SIZE, type PcSettings } from '../../render/printSettings'
import { buildTopupLabel, renderTopupLabelSvg, TOPUP_LABEL_SIZE_REFUSAL, type BuildTopupLabelResult } from '../../render/topupLabel'
import { Field } from './LabelScreen'
import { LabelFrame } from './LabelPreview'
import { OutcomeMessage } from './OutcomeMessage'
import { PrinterGuideLink } from './PrinterGuide'

const SYMBOLOGIES: readonly { value: Symbology; label: string }[] = [
  { value: 'qr', label: 'QR' },
  { value: 'datamatrix', label: 'DataMatrix' }
]

const SYMBOLOGY_NAMES: Record<Symbology, string> = { qr: 'QR', datamatrix: 'DataMatrix' }

function parseCopies(value: string): number {
  return /^[0-9]{1,3}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN
}

interface TopupLabelScreenProps {
  /** This PC's settings: the loaded Label Size, the Printer resolution and the last code type. */
  settings: PcSettings
  /** The Template picker of the Custom Label tab, shown first. */
  templatePicker: React.ReactNode
  /** QR or DataMatrix: kept by the tab, starting from this PC's last one. */
  symbology: Symbology
  onSymbology(symbology: Symbology): void
}

/**
 * The built-in Topup layout of the Custom Label tab (GLOSSARY Topup Label): an Item Code typed or
 * scanned, looked up in the Topup Database, QR or DataMatrix, copies, the preview and Print. The app
 * service rebuilds and checks the label; this screen sends only the request.
 */
export function TopupLabelScreen({ settings, templatePicker, symbology, onSymbology }: TopupLabelScreenProps): React.JSX.Element {
  const [itemCode, setItemCode] = useState('')
  const [lookup, setLookup] = useState<TopupLookup | null>(null)
  const [copies, setCopies] = useState('1')
  const [printing, setPrinting] = useState(false)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)
  const printButton = useRef<HTMLButtonElement>(null)

  const typed = itemCode.trim()
  useEffect(() => {
    if (typed === '') {
      setLookup(null)
      return
    }
    let current = true
    window.api.lookupTopup(typed).then(
      (found) => {
        if (current) setLookup(found)
      },
      () => {
        if (current) setLookup(null)
      }
    )
    return () => {
      current = false
    }
  }, [typed])

  const found = lookup?.status === 'found' && typed !== '' ? lookup : null
  const result = useMemo<BuildTopupLabelResult | null>(
    () =>
      found ? buildTopupLabel({ itemCode: found.entry.itemCode, content: found.content, symbology, copies: parseCopies(copies) }, settings.printerResolution) : null,
    [found, symbology, copies, settings.printerResolution]
  )
  const svg = useMemo(() => (result?.ok ? renderTopupLabelSvg(result.label) : null), [result])
  const sizeProblem = settings.labelSizeId === TOPUP_TAPE_SIZE.id ? null : TOPUP_LABEL_SIZE_REFUSAL
  const unknown = lookup?.status === 'unknown' && typed !== '' ? lookup.message : null
  const printable = result?.ok === true && sizeProblem === null && !printing

  async function print(): Promise<void> {
    if (!printable || !found) return
    setPrinting(true)
    setOutcome(null)
    try {
      setOutcome(await window.api.printTopupLabel({ itemCode: found.entry.itemCode, symbology, copies: parseCopies(copies) }))
    } catch (error) {
      setOutcome({ ok: false, message: `Not printed: ${String(error)}` })
    } finally {
      setPrinting(false)
    }
  }

  const copiesErrors = result && !result.ok && result.message.startsWith('Copies') ? [result.message] : []
  const codeErrors = result && !result.ok && copiesErrors.length === 0 ? [result.message] : []

  return (
    <main className="layout">
      <section className="panel form" aria-label="Topup Label details">
        <h2>Custom Label</h2>
        {templatePicker}
        <div className="field__messages" aria-live="polite">
          <p className="message message--hint">
            {TOPUP_TAPE_SIZE.name} ({formatLabelSizeMm(TOPUP_TAPE_SIZE)}), code from the Topup Database, built in
          </p>
          {sizeProblem && (
            <>
              <p className="message message--error">{sizeProblem}</p>
              <p className="outcome__guide">
                <PrinterGuideLink />
              </p>
            </>
          )}
        </div>

        <Field label="Item Code" field="topup-item-code" errors={unknown ? [unknown] : []} hint="Type or scan">
          <input
            id="topup-item-code"
            type="text"
            className={unknown ? 'code invalid' : 'code'}
            value={itemCode}
            onChange={(event) => {
              setItemCode(event.target.value)
              setOutcome(null)
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (printable) printButton.current?.focus()
            }}
            aria-invalid={unknown !== null}
            aria-describedby="topup-item-code-messages"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </Field>

        {found && (
          <dl className="topup-details" aria-label="Drug">
            <dt>Display name</dt>
            <dd>{found.entry.displayName || '—'}</dd>
            <dt>Salt</dt>
            <dd>{found.entry.salt || '—'}</dd>
            <dt>Form</dt>
            <dd>{found.entry.formCode || '—'}</dd>
          </dl>
        )}

        <fieldset className="field pack-volume">
          <legend>Code</legend>
          <div className="segmented segmented--two" role="radiogroup" aria-label="Code">
            {SYMBOLOGIES.map((choice) => (
              <label key={choice.value} className={symbology === choice.value ? 'segment segment--selected' : 'segment'}>
                <input
                  type="radio"
                  name="topup-symbology"
                  value={choice.value}
                  checked={symbology === choice.value}
                  onChange={() => {
                    onSymbology(choice.value)
                    setOutcome(null)
                  }}
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Copies" field="topup-copies" errors={copiesErrors} hint="1–99">
          <input
            id="topup-copies"
            type="text"
            className={copiesErrors.length > 0 ? 'copies invalid' : 'copies'}
            value={copies}
            onChange={(event) => {
              setCopies(event.target.value)
              setOutcome(null)
            }}
            aria-invalid={copiesErrors.length > 0}
            aria-describedby="topup-copies-messages"
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>

        <div className="actions">
          <button ref={printButton} type="button" className="print-button" disabled={!printable} onClick={() => void print()}>
            {printing ? 'Printing…' : 'Print'}
          </button>
          {!result?.ok && !outcome && <span className="actions__note">Enter an Item Code in the Topup Database to print.</span>}
        </div>
        <OutcomeMessage outcome={outcome} />
      </section>

      <section className="panel preview" aria-label="Label preview">
        <h2>Preview</h2>
        <LabelFrame svg={svg} size={TOPUP_TAPE_SIZE} />
        {result?.ok ? (
          <p className="gs1-data" role="status">
            {SYMBOLOGY_NAMES[result.label.symbology]} {result.label.symbol.columns} × {result.label.symbol.rows}, module {result.label.moduleMm.toFixed(2)} mm, holds{' '}
            <code>{result.label.content}</code>
          </p>
        ) : (
          codeErrors.length > 0 && (
            <p className="self-check self-check--fail" role="status">
              ✗ Not printable: {codeErrors.join(' ')}
            </p>
          )
        )}
      </section>
    </main>
  )
}
