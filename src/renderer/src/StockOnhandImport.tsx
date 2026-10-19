import { useEffect, useRef } from 'react'
import { countOf, formatFileDate } from '../../core/itemList'
import {
  describeStockOnhand,
  describeStockOnhandImport,
  formatReportDate,
  isStockOnhandForToday,
  STOCK_ONHAND_REPORT_NAME,
  stockOnhandLocation,
  stockOnhandStatusText,
  stockOnhandValidity,
  type StockOnhandInfo
} from '../../core/stockOnhand'
import type { ImportStockOnhandOutcome } from '../../preload/api'
import { BadRows } from './ItemListImport'
import { useImport, type ImportState } from './useImport'

export type StockOnhandImportState = ImportState<Exclude<ImportStockOnhandOutcome, { status: 'cancelled' }>, StockOnhandInfo>

/**
 * Runs a Stock Onhand import (the main process shows the file dialog) and remembers its outcome.
 * `onImported` hears about a newly imported Stock Onhand, whatever its Report Date.
 */
export function useStockOnhandImport(current: StockOnhandInfo | null, onImported: (info: StockOnhandInfo) => void) {
  return useImport(() => window.api.importStockOnhand(), current, onImported)
}

/** True once the last import brought in a Stock Onhand dated `today`. */
export function importedForToday(state: StockOnhandImportState, today: string): boolean {
  return state.status === 'done' && state.outcome.status === 'imported' && isStockOnhandForToday(state.outcome.info, today)
}

/** The outcome of the last import: its summary, or why the report was refused. */
export function StockOnhandOutcome({ state, today }: { state: StockOnhandImportState; today: string }): React.JSX.Element | null {
  if (state.status === 'idle' || state.status === 'importing') return null
  if (state.status === 'error') {
    return (
      <div className="outcome" role="status">
        <p className="outcome__message outcome__message--error">✗ Not imported: {state.message}</p>
      </div>
    )
  }
  const { outcome, previous } = state
  if (outcome.status === 'imported') {
    const { summary, info } = outcome
    const skipped = [
      summary.badRows > 0 ? countOf(summary.badRows, 'bad row') : null,
      summary.withoutLot > 0 ? `${countOf(summary.withoutLot, 'row')} without a Lot` : null
    ].filter((part) => part !== null)
    return (
      <div className="outcome" role="status">
        <p className="outcome__message outcome__message--ok">✓ Imported {describeStockOnhand(info)}.</p>
        {skipped.length > 0 && <p className="message message--hint import-skipped">Skipped {skipped.join(' and ')}.</p>}
        {outcome.notInItemList !== null && outcome.notInItemList > 0 && (
          <p className="message message--hint import-skipped">
            {countOf(outcome.notInItemList, 'Item Code')} in it {outcome.notInItemList === 1 ? 'is' : 'are'} not in the Item List.
          </p>
        )}
        {!isStockOnhandForToday(info, today) && (
          <p className="message message--warning import-skipped">
            ⚠ This report is dated {formatReportDate(info.reportDate)}, not today: its Lots cannot be picked today. Import today&apos;s file.
          </p>
        )}
        <BadRows rows={outcome.badRows} />
        {outcome.warning && <p className="message message--warning">⚠ {outcome.warning}</p>}
      </div>
    )
  }
  return (
    <div className="outcome" role="alert">
      <p className="outcome__message outcome__message--error">✗ Not imported: {outcome.message}</p>
      {previous && (
        <p className="message message--hint import-skipped">The Stock Onhand in use (dated {formatReportDate(previous.reportDate)}) is kept.</p>
      )}
      <BadRows rows={outcome.badRows} />
      {outcome.warning && <p className="message message--warning">⚠ {outcome.warning}</p>}
    </div>
  )
}

/** The header's Stock Onhand: its Report Date and location, or that it is stale or missing. */
export function StockOnhandStatus({ stockOnhand, today }: { stockOnhand: StockOnhandInfo | null; today: string }): React.JSX.Element {
  const validity = stockOnhandValidity(stockOnhand, today)
  const title = stockOnhand ? `${stockOnhandStatusText(stockOnhand, today)}. ${describeStockOnhand(stockOnhand)}` : stockOnhandStatusText(null, today)
  return (
    <span className={validity === 'today' ? 'header-info' : 'header-info header-info--stale'} title={title}>
      Stock Onhand{' '}
      {stockOnhand === null ? (
        <strong>none</strong>
      ) : validity === 'stale' ? (
        <>
          <strong>dated {formatReportDate(stockOnhand.reportDate)}</strong> — import today&apos;s file
        </>
      ) : (
        <>
          <strong>{formatReportDate(stockOnhand.reportDate)}</strong>
          {stockOnhandLocation(stockOnhand) && ` (${stockOnhandLocation(stockOnhand)})`}
        </>
      )}
    </span>
  )
}

/** Report Date, location, counts and who imported the Stock Onhand in use. */
function StockOnhandDetails({ info, today }: { info: StockOnhandInfo; today: string }): React.JSX.Element {
  const location = [info.organizationCode, info.subinventoryCode].filter((code) => code !== '').join(' / ')
  return (
    <dl className="item-list-details">
      <dt>Report Date</dt>
      <dd>
        {formatReportDate(info.reportDate)}
        {info.reportTime && ` ${info.reportTime}`}
        {!isStockOnhandForToday(info, today) && <span className="stale-note"> — not today: Lots cannot be picked from it</span>}
      </dd>
      {location && (
        <>
          <dt>Stock</dt>
          <dd>{location}</dd>
        </>
      )}
      <dt>Lots</dt>
      <dd>
        {countOf(info.lots, 'Lot')} of {countOf(info.items, 'item')}
      </dd>
      <dt>File</dt>
      <dd>
        {info.sourceFileName}, dated {formatFileDate(info.sourceModified)}
      </dd>
      <dt>Imported</dt>
      <dd>{describeStockOnhandImport(info)}</dd>
    </dl>
  )
}

interface StockOnhandPanelProps {
  stockOnhand: StockOnhandInfo | null
  today: string
  onImported(info: StockOnhandInfo): void
}

/** The Stock Onhand section of Settings. */
export function StockOnhandPanel({ stockOnhand, today, onImported }: StockOnhandPanelProps): React.JSX.Element {
  const importer = useStockOnhandImport(stockOnhand, onImported)
  return (
    <section className="panel settings" aria-label="Stock Onhand">
      <h2>Stock Onhand</h2>
      <p className="settings__intro">
        The daily report &ldquo;{STOCK_ONHAND_REPORT_NAME}&rdquo; (.ps). Shared by all PCs using this folder; Lots can be picked from it only on its
        Report Date.
      </p>
      {stockOnhand ? <StockOnhandDetails info={stockOnhand} today={today} /> : <p className="message message--hint">None imported.</p>}
      <div className="actions">
        <button type="button" className="button button--secondary" onClick={() => void importer.start()} disabled={importer.busy}>
          {importer.busy ? 'Importing…' : 'Import Stock Onhand…'}
        </button>
      </div>
      <StockOnhandOutcome state={importer.state} today={today} />
    </section>
  )
}

interface StockOnhandPromptProps {
  stockOnhand: StockOnhandInfo | null
  today: string
  /** Why an existing Stock Onhand was not used (changed outside the app, or unreadable). */
  notice: string | null
  onImported(info: StockOnhandInfo): void
  /** Skip (type Lots by hand today) or Continue after importing today's file. */
  onClose(): void
}

/** At launch, when there is no Stock Onhand dated today: Import, or Skip and type Lots by hand. */
export function StockOnhandPrompt({ stockOnhand, today, notice, onImported, onClose }: StockOnhandPromptProps): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const importer = useStockOnhandImport(stockOnhand, onImported)
  const done = importedForToday(importer.state, today)
  /** Closes the dialog while it is still in the page, so focus returns to where it was (the Item Code). */
  const close = (): void => {
    dialog.current?.close()
    onClose()
  }

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="stock-prompt-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!importer.busy) close()
      }}
    >
      <h2 id="stock-prompt-title" className="dialog__title">
        Import today&apos;s Stock Onhand
      </h2>
      {!done && (
        <p>
          {stockOnhand
            ? `The Stock Onhand in use is dated ${formatReportDate(stockOnhand.reportDate)}, so its Lots cannot be picked today.`
            : 'No Stock Onhand has been imported.'}{' '}
          Import today&apos;s report &ldquo;{STOCK_ONHAND_REPORT_NAME}&rdquo; to pick Lots from it, or skip and type Lots by hand today.
        </p>
      )}
      {notice && !done && <p className="message message--warning dialog__still">⚠ {notice}</p>}
      <StockOnhandOutcome state={importer.state} today={today} />
      <div className="dialog__choices">
        {done ? (
          <button type="button" className="button button--primary" onClick={close} autoFocus>
            Continue
          </button>
        ) : (
          <>
            <button type="button" className="button button--primary" onClick={() => void importer.start()} disabled={importer.busy} autoFocus>
              {importer.busy ? 'Importing…' : 'Import'}
            </button>
            <button type="button" className="button button--secondary" onClick={close} disabled={importer.busy}>
              Skip
            </button>
          </>
        )}
      </div>
    </dialog>
  )
}
