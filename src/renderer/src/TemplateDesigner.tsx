import { useMemo, useRef, useState } from 'react'
import {
  DESIGN_GRID_MM,
  DOTS_PER_MODULE_CHOICES,
  MAX_TEXT_LENGTH,
  MAX_TEXT_LINES,
  normaliseTemplateName,
  TEXT_SIZE_CHOICES,
  type ElementMode,
  type Template,
  type TemplateCode,
  type TemplateText
} from '../../core/template'
import type { TemplateChangeOutcome } from '../../preload/api'
import { codeArea, templatePreviewSvg, templateProblems, textBox, textMaxLength, type Box } from '../../render/customLabel'
import { DOT_MM } from '../../render/dataMatrix'
import { formatLabelSizeMm, type LabelSizeEntry } from '../../render/printSettings'

/** The preview shows the label this many times its printed size (shrinking if the window is narrow). */
const PREVIEW_SCALE = 4
/** A drag shorter than this (in mm) is a click that selects, not a move. */
const DRAG_THRESHOLD_MM = 0.25
/** Shift + arrow moves this far. */
const BIG_STEP_MM = 2

type Selected = 'code' | string

function snap(mm: number): number {
  return Math.round(mm / DESIGN_GRID_MM) * DESIGN_GRID_MM
}

/** A new Template for `size`: the code on the left, one fill-in line beside it, all on the 0.5 mm grid. */
export function newTemplate(size: LabelSizeEntry): Template {
  const middle = snap(size.heightMm / 2)
  return {
    id: '',
    name: '',
    labelSizeId: size.id,
    builtIn: false,
    code: { xMm: 7, yMm: middle, symbology: 'datamatrix', dotsPerModule: 3, mode: 'fill' },
    texts: [{ id: 'line-1', xMm: 14, yMm: middle - 1, widthMm: Math.max(DESIGN_GRID_MM, Math.floor((size.widthMm - 15) / DESIGN_GRID_MM) * DESIGN_GRID_MM), align: 'left', fontSizePt: 8, bold: false, mode: 'fill' }]
  }
}

interface TemplateDesignerProps {
  /** The Template to edit: a saved one, or a new one (id `''`). */
  initial: Template
  size: LabelSizeEntry
  /** Every Template, for the name check. */
  templates: readonly Template[]
  onSaved(outcome: Extract<TemplateChangeOutcome, { ok: true }>): void
  onCancel(): void
}

/**
 * The Template designer: a scaled preview where the code and the text lines are dragged with the
 * mouse or moved with the arrow keys (0.5 mm, Shift 2 mm), snapping to the 0.5 mm grid; the selected
 * element's settings beside it. Problems show as they arise; Save is refused while there are any.
 */
export function TemplateDesigner({ initial, size, templates, onSaved, onCancel }: TemplateDesignerProps): React.JSX.Element {
  const [draft, setDraft] = useState<Template>(initial)
  const [selected, setSelected] = useState<Selected>('code')
  const [saving, setSaving] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: Selected; pointerId: number; startX: number; startY: number; fromX: number; fromY: number; moved: boolean } | null>(null)
  /** The saved version: its positions need not be on the grid (a copy of Layout 1 or 2 keeps them). */
  const original = initial.id === '' ? null : initial

  const named = normaliseTemplateName(draft.name)
  const taken = named.ok ? templates.find((entry) => entry.id !== draft.id && entry.name.toLowerCase() === named.name.toLowerCase()) : undefined
  const problems = useMemo(() => templateProblems(draft, size, original), [draft, size, original])
  const allProblems = [...(named.ok ? [] : [named.message]), ...(taken ? [`There is already a template named "${taken.name}".`] : []), ...problems]
  const svg = useMemo(() => templatePreviewSvg(draft, size), [draft, size])
  const code = codeArea(draft.code, size)
  const text = draft.texts.find((entry) => entry.id === selected)
  const textIndex = draft.texts.findIndex((entry) => entry.id === selected)

  function change(next: Template): void {
    setDraft(next)
    setRefused(null)
  }

  function changeCode(patch: Partial<TemplateCode>): void {
    change({ ...draft, code: { ...draft.code, ...patch } })
  }

  function changeText(id: string, patch: Partial<TemplateText>): void {
    change({ ...draft, texts: draft.texts.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) })
  }

  function positionOf(template: Template, id: Selected): { xMm: number; yMm: number } {
    return id === 'code' ? template.code : (template.texts.find((entry) => entry.id === id) ?? { xMm: 0, yMm: 0 })
  }

  /** Moves an element to where `to` says from its current position (from the latest draft, so quick key repeats all count). */
  function moveTo(id: Selected, to: (from: { xMm: number; yMm: number }) => { xMm: number; yMm: number }): void {
    setRefused(null)
    setDraft((previous) => {
      const { xMm, yMm } = to(positionOf(previous, id))
      if (id === 'code') return { ...previous, code: { ...previous.code, xMm, yMm } }
      return { ...previous, texts: previous.texts.map((entry) => (entry.id === id ? { ...entry, xMm, yMm } : entry)) }
    })
  }

  /** One printed mm in screen pixels. */
  function pxPerMm(): number {
    const width = frame.current?.getBoundingClientRect().width ?? 0
    return width > 0 ? width / size.widthMm : 1
  }

  function onPointerDown(event: React.PointerEvent, id: Selected): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    ;(event.currentTarget as HTMLElement).focus()
    setSelected(id)
    const from = positionOf(draft, id)
    drag.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, fromX: from.xMm, fromY: from.yMm, moved: false }
  }

  function onPointerMove(event: React.PointerEvent): void {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const scale = pxPerMm()
    const dx = (event.clientX - current.startX) / scale
    const dy = (event.clientY - current.startY) / scale
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_MM) return
    current.moved = true
    moveTo(current.id, () => ({ xMm: snap(current.fromX + dx), yMm: snap(current.fromY + dy) }))
  }

  function onPointerUp(event: React.PointerEvent): void {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  function onKeyDown(event: React.KeyboardEvent, id: Selected): void {
    const step = event.shiftKey ? BIG_STEP_MM : DESIGN_GRID_MM
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    moveTo(id, (from) => ({ xMm: snap(from.xMm + delta[0]), yMm: snap(from.yMm + delta[1]) }))
  }

  function addLine(): void {
    if (draft.texts.length >= MAX_TEXT_LINES) return
    let n = draft.texts.length + 1
    while (draft.texts.some((entry) => entry.id === `line-${n}`)) n++
    const last = draft.texts[draft.texts.length - 1]
    const line: TemplateText = last
      ? { ...last, id: `line-${n}`, yMm: snap(last.yMm + 3), mode: 'fill', value: undefined, maxLength: undefined }
      : { id: `line-${n}`, xMm: 1, yMm: 1, widthMm: snap(Math.min(20, size.widthMm - 2)), align: 'left', fontSizePt: 8, bold: false, mode: 'fill' }
    change({ ...draft, texts: [...draft.texts, line] })
    setSelected(line.id)
  }

  function deleteLine(id: string): void {
    change({ ...draft, texts: draft.texts.filter((entry) => entry.id !== id) })
    setSelected('code')
  }

  async function save(): Promise<void> {
    if (allProblems.length > 0 || saving) return
    setSaving(true)
    setRefused(null)
    try {
      const outcome = await window.api.saveTemplate(draft)
      if (outcome.ok) onSaved(outcome)
      else setRefused(outcome.message)
    } catch (error) {
      setRefused(String(error))
    } finally {
      setSaving(false)
    }
  }

  const overlay = (id: Selected, box: Box, label: string): React.JSX.Element => (
    <div
      key={id}
      role="button"
      tabIndex={0}
      aria-label={`${label}: drag, or use the arrow keys (Shift for ${BIG_STEP_MM} mm)`}
      aria-pressed={selected === id}
      className={selected === id ? 'designer__element designer__element--selected' : 'designer__element'}
      style={{
        left: `${(box.xMm / size.widthMm) * 100}%`,
        top: `${(box.yMm / size.heightMm) * 100}%`,
        width: `${(box.widthMm / size.widthMm) * 100}%`,
        height: `${(box.heightMm / size.heightMm) * 100}%`
      }}
      onPointerDown={(event) => onPointerDown(event, id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => onKeyDown(event, id)}
      onFocus={() => setSelected(id)}
    />
  )

  return (
    <main className="layout designer">
      <section className="panel form" aria-label="Template settings">
        <h2>{initial.id === '' ? 'New template' : `Edit template`}</h2>
        <div className="field">
          <label htmlFor="template-name">Name</label>
          <input id="template-name" type="text" value={draft.name} autoComplete="off" onChange={(event) => change({ ...draft, name: event.target.value })} />
          <p className="message message--hint">
            For {size.name} ({formatLabelSizeMm(size)})
          </p>
        </div>

        {selected === 'code' ? (
          <fieldset className="field-group" aria-label="Code">
            <legend>Code</legend>
            <Choice
              label="Default code"
              name="designer-symbology"
              value={draft.code.symbology}
              choices={[
                ['datamatrix', 'DataMatrix'],
                ['qr', 'QR']
              ]}
              onChange={(symbology) => changeCode({ symbology })}
            />
            <div className="field">
              <label htmlFor="designer-dots">Module size</label>
              <select id="designer-dots" value={draft.code.dotsPerModule} onChange={(event) => changeCode({ dotsPerModule: Number(event.target.value) as TemplateCode['dotsPerModule'] })}>
                {DOTS_PER_MODULE_CHOICES.map((dots) => (
                  <option key={dots} value={dots}>
                    {dots} dots ({(dots * DOT_MM).toFixed(2)} mm)
                  </option>
                ))}
              </select>
            </div>
            <ModeAndValue
              id="designer-code"
              mode={draft.code.mode}
              value={draft.code.value ?? ''}
              fillHint="Typed when printing"
              onMode={(mode) => changeCode({ mode })}
              onValue={(value) => changeCode({ value })}
            />
            <p className="message message--hint">
              Centre at {draft.code.xMm.toFixed(1)}, {draft.code.yMm.toFixed(1)} mm
            </p>
          </fieldset>
        ) : (
          text && (
            <fieldset className="field-group" aria-label={`Line ${textIndex + 1}`}>
              <legend>Line {textIndex + 1}</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="designer-size">Text size</label>
                  <select id="designer-size" value={text.fontSizePt} onChange={(event) => changeText(text.id, { fontSizePt: Number(event.target.value) as TemplateText['fontSizePt'] })}>
                    {TEXT_SIZE_CHOICES.map((pt) => (
                      <option key={pt} value={pt}>
                        {pt} pt
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="designer-width">Width (mm)</label>
                  <input
                    id="designer-width"
                    type="number"
                    className="number"
                    step={DESIGN_GRID_MM}
                    min={DESIGN_GRID_MM}
                    value={text.widthMm}
                    onChange={(event) => {
                      const widthMm = Number(event.target.value)
                      if (Number.isFinite(widthMm) && widthMm > 0) changeText(text.id, { widthMm })
                    }}
                  />
                </div>
              </div>
              <label className="designer__check">
                <input type="checkbox" checked={text.bold} onChange={(event) => changeText(text.id, { bold: event.target.checked })} /> Bold
              </label>
              <Choice
                label="Align"
                name="designer-align"
                value={text.align}
                choices={[
                  ['left', 'Left'],
                  ['center', 'Centre']
                ]}
                onChange={(align) => changeText(text.id, { align })}
              />
              <ModeAndValue
                id="designer-text"
                mode={text.mode}
                value={text.value ?? ''}
                fillHint="Typed when printing; may be empty"
                onMode={(mode) => changeText(text.id, { mode })}
                onValue={(value) => changeText(text.id, { value })}
              />
              {text.mode === 'fill' && (
                <div className="field">
                  <label htmlFor="designer-max">Maximum characters</label>
                  <input
                    id="designer-max"
                    type="number"
                    className="number"
                    min={1}
                    max={MAX_TEXT_LENGTH}
                    placeholder={`auto (${textMaxLength({ ...text, maxLength: undefined })})`}
                    value={text.maxLength ?? ''}
                    onChange={(event) => changeText(text.id, { maxLength: event.target.value === '' ? undefined : Number(event.target.value) })}
                  />
                </div>
              )}
              <p className="message message--hint">
                Top-left at {text.xMm.toFixed(1)}, {text.yMm.toFixed(1)} mm
              </p>
              <button type="button" className="button button--secondary button--small" onClick={() => deleteLine(text.id)}>
                Delete line {textIndex + 1}
              </button>
            </fieldset>
          )
        )}

        <div className="field__buttons">
          <button type="button" className="button button--secondary button--small" disabled={draft.texts.length >= MAX_TEXT_LINES} onClick={addLine}>
            Add text line
          </button>
          <span className="field__note">
            {draft.texts.length} of {MAX_TEXT_LINES} lines
          </span>
        </div>

        <div className="field__messages" aria-live="polite">
          {allProblems.map((problem) => (
            <p key={problem} className="message message--error">
              {problem}
            </p>
          ))}
          {refused && (
            <p className="message message--error" role="alert">
              {refused}
            </p>
          )}
        </div>
        <div className="actions">
          <button type="button" className="button button--primary" disabled={allProblems.length > 0 || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
          <button type="button" className="button button--secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          {allProblems.length > 0 && <span className="actions__note">Fix the problems to save.</span>}
        </div>
      </section>

      <section className="panel preview" aria-label="Template preview">
        <h2>Layout</h2>
        <div
          ref={frame}
          className="label-frame designer__frame"
          style={{ width: `${size.widthMm * PREVIEW_SCALE}mm`, aspectRatio: `${size.widthMm} / ${size.heightMm}` }}
        >
          {/* The SVG is built by our renderer; text in it is escaped. */}
          <div className="label-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          {overlay('code', code.box, 'Code')}
          {draft.texts.map((entry, i) => overlay(entry.id, textBox(entry), `Line ${i + 1}`))}
        </div>
        <p className="preview-caption">
          {size.widthMm} × {size.heightMm} mm label, enlarged. The code's box includes its quiet zone. Click an element to select it.
        </p>
      </section>
    </main>
  )
}

function Choice<T extends string>({
  label,
  name,
  value,
  choices,
  onChange
}: {
  label: string
  name: string
  value: T
  choices: readonly (readonly [T, string])[]
  onChange(value: T): void
}): React.JSX.Element {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="segmented segmented--two" role="radiogroup" aria-label={label}>
        {choices.map(([choice, text]) => (
          <label key={choice} className={value === choice ? 'segment segment--selected' : 'segment'}>
            <input type="radio" name={name} value={choice} checked={value === choice} onChange={() => onChange(choice)} />
            {text}
          </label>
        ))}
      </div>
    </div>
  )
}

function ModeAndValue({
  id,
  mode,
  value,
  fillHint,
  onMode,
  onValue
}: {
  id: string
  mode: ElementMode
  value: string
  fillHint: string
  onMode(mode: ElementMode): void
  onValue(value: string): void
}): React.JSX.Element {
  return (
    <>
      <Choice
        label="Value"
        name={`${id}-mode`}
        value={mode}
        choices={[
          ['fill', 'Fill-in'],
          ['fixed', 'Fixed']
        ]}
        onChange={onMode}
      />
      {mode === 'fixed' ? (
        <div className="field">
          <label htmlFor={`${id}-value`}>Fixed value</label>
          <input id={`${id}-value`} type="text" className="code" value={value} autoComplete="off" spellCheck={false} onChange={(event) => onValue(event.target.value)} />
        </div>
      ) : (
        <p className="message message--hint">{fillHint}</p>
      )}
    </>
  )
}
