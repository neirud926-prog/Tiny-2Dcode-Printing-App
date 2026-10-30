import { showsPrinterGuide } from '../../app/printService'
import type { PrintOutcome } from '../../preload/api'
import { PrinterGuideLink } from './PrinterGuide'

/** The result of a print or save, under the buttons; a tape check message gets the printer guide link. */
export function OutcomeMessage({ outcome }: { outcome: PrintOutcome | { ok: false; message: string } | null }): React.JSX.Element {
  return (
    <div className="outcome" role="status" aria-live="polite">
      {outcome && <p className={outcome.ok ? 'outcome__message outcome__message--ok' : 'outcome__message outcome__message--error'}>{outcome.ok ? `✓ ${outcome.message}` : `✗ ${outcome.message}`}</p>}
      {outcome?.ok && outcome.warning && <p className="message message--warning">⚠ {outcome.warning}</p>}
      {showsPrinterGuide(outcome) && (
        <p className="outcome__guide">
          <PrinterGuideLink />
        </p>
      )}
    </div>
  )
}
