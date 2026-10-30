import { countOf, formatFileDate } from '../../core/itemList'
import type { TopupDatabaseInfo } from '../../core/topup'
import { BadRows, localTime } from './ItemListImport'
import { useImport } from './useImport'

interface TopupDatabasePanelProps {
  /** The Topup Database in use: imported, or built in. */
  topupDatabase: TopupDatabaseInfo
  /** Why an imported one was not used, so the built-in one is. */
  notice: string | null
  onImported(info: TopupDatabaseInfo): void
}

/** The Topup Database section of Settings: which one is in use, and importing a newer workbook. */
export function TopupDatabasePanel({ topupDatabase, notice, onImported }: TopupDatabasePanelProps): React.JSX.Element {
  const importer = useImport(() => window.api.importTopupDatabase(), topupDatabase, onImported)
  const state = importer.state
  const importedHere = state.status === 'done' && state.outcome.status === 'imported'

  return (
    <section className="panel settings" aria-label="Topup Database">
      <h2>Topup Database</h2>
      <p className="settings__intro">
        The drugs a Topup Label can be printed for. One is built into the app; importing a newer QRCode for Topup.xlsm replaces it for all PCs
        using this folder.
      </p>
      {notice && !importedHere && (
        <p className="message message--warning settings__notice" role="alert">
          ⚠ {notice}
        </p>
      )}

      <dl className="item-list-details">
        <dt>In use</dt>
        <dd>{topupDatabase.source === 'built-in' ? 'Built into the app' : 'Imported'}</dd>
        <dt>File</dt>
        <dd>
          {topupDatabase.sourceFileName}, dated {formatFileDate(topupDatabase.sourceModified)}
        </dd>
        <dt>Rows</dt>
        <dd>{countOf(topupDatabase.entries, 'Item Code')}</dd>
        {topupDatabase.importedAt !== null && (
          <>
            <dt>Imported</dt>
            <dd>
              {formatFileDate(topupDatabase.importedAt)} {localTime(topupDatabase.importedAt)} by {topupDatabase.importedBy} on {topupDatabase.pc}
            </dd>
          </>
        )}
      </dl>

      <div className="actions">
        <button type="button" className="button button--secondary" onClick={() => void importer.start()} disabled={importer.busy}>
          {importer.busy ? 'Importing…' : 'Import Topup Database…'}
        </button>
      </div>

      {state.status === 'error' && (
        <div className="outcome" role="status">
          <p className="outcome__message outcome__message--error">✗ Not imported: {state.message}</p>
        </div>
      )}
      {state.status === 'done' && state.outcome.status === 'imported' && (
        <div className="outcome" role="status">
          <p className="outcome__message outcome__message--ok">✓ Imported {countOf(state.outcome.info.entries, 'Item Code')}.</p>
          {state.outcome.summary.badRows + state.outcome.summary.duplicates > 0 && (
            <p className="message message--hint import-skipped">
              Skipped{' '}
              {[
                state.outcome.summary.badRows > 0 ? countOf(state.outcome.summary.badRows, 'bad row') : null,
                state.outcome.summary.duplicates > 0 ? countOf(state.outcome.summary.duplicates, 'repeated Item Code') : null
              ]
                .filter((part) => part !== null)
                .join(' and ')}
              .
            </p>
          )}
          <BadRows rows={state.outcome.badRows} />
          {state.outcome.warning && <p className="message message--warning">⚠ {state.outcome.warning}</p>}
        </div>
      )}
      {state.status === 'done' && state.outcome.status === 'refused' && (
        <div className="outcome" role="alert">
          <p className="outcome__message outcome__message--error">✗ Not imported: {state.outcome.message}</p>
          <p className="message message--hint import-skipped">The Topup Database in use is kept.</p>
          <BadRows rows={state.outcome.badRows} />
          {state.outcome.warning && <p className="message message--warning">⚠ {state.outcome.warning}</p>}
        </div>
      )}
    </section>
  )
}
