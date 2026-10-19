import type { PrintOutcome } from '../../preload/api'

/** The result of a print or save, under the buttons. */
export function OutcomeMessage({ outcome }: { outcome: PrintOutcome | { ok: false; message: string } | null }): React.JSX.Element {
  return (
    <div className="outcome" role="status" aria-live="polite">
      {outcome && <p className={outcome.ok ? 'outcome__message outcome__message--ok' : 'outcome__message outcome__message--error'}>{outcome.ok ? `✓ ${outcome.message}` : `✗ ${outcome.message}`}</p>}
      {outcome?.ok && outcome.warning && <p className="message message--warning">⚠ {outcome.warning}</p>}
    </div>
  )
}
