import { useState } from 'react'
import { countOf, describeItemList, formatFileDate, type ItemListInfo } from '../../core/itemList'
import type { ImportItemListOutcome } from '../../preload/api'

/** What the last import did, shown under the import button. */
export type ImportState =
  | { readonly status: 'idle' }
  | { readonly status: 'importing' }
  | {
      readonly status: 'done'
      readonly outcome: Exclude<ImportItemListOutcome, { status: 'cancelled' }>
      /** The Item List in use before the import (kept if the file was refused). */
      readonly previous: ItemListInfo | null
    }
  | { readonly status: 'error'; readonly message: string }

/**
 * Runs an Item List import (the main process shows the file dialog) and remembers its outcome.
 * `onImported` hears about a newly imported Item List. `start` resolves with the outcome.
 */
export function useItemListImport(current: ItemListInfo | null, onImported: (info: ItemListInfo) => void) {
  const [state, setState] = useState<ImportState>({ status: 'idle' })

  async function start(): Promise<ImportItemListOutcome | null> {
    if (state.status === 'importing') return null
    const previous = current
    setState({ status: 'importing' })
    try {
      const outcome = await window.api.importItemList()
      if (outcome.status === 'cancelled') {
        setState({ status: 'idle' })
      } else {
        setState({ status: 'done', outcome, previous })
        if (outcome.status === 'imported') onImported(outcome.info)
      }
      return outcome
    } catch (error) {
      setState({ status: 'error', message: String(error) })
      return null
    }
  }

  return { state, busy: state.status === 'importing', start, clear: () => setState({ status: 'idle' }) }
}

/** The outcome of the last import: its summary, or why the file was refused. */
export function ImportOutcome({ state }: { state: ImportState }): React.JSX.Element | null {
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
    const { summary } = outcome
    const skipped = [
      summary.badRows > 0 ? countOf(summary.badRows, 'bad row') : null,
      summary.duplicates > 0 ? countOf(summary.duplicates, 'repeated Item Code') : null
    ].filter((part) => part !== null)
    return (
      <div className="outcome" role="status">
        <p className="outcome__message outcome__message--ok">✓ Imported {describeItemList(outcome.info)}.</p>
        {skipped.length > 0 && <p className="message message--hint import-skipped">Skipped {skipped.join(' and ')}.</p>}
        <BadRows rows={outcome.badRows} />
        {outcome.warning && <p className="message message--warning">⚠ {outcome.warning}</p>}
      </div>
    )
  }
  return (
    <div className="outcome" role="alert">
      <p className="outcome__message outcome__message--error">✗ Not imported: {outcome.message}</p>
      {previous && (
        <p className="message message--hint import-skipped">The Item List in use (file dated {formatFileDate(previous.sourceModified)}) is kept.</p>
      )}
      <BadRows rows={outcome.badRows} />
      {outcome.warning && <p className="message message--warning">⚠ {outcome.warning}</p>}
    </div>
  )
}

function BadRows({ rows }: { rows: readonly { line: number; message: string }[] }): React.JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <ul className="bad-rows">
      {rows.map((row) => (
        <li key={row.line}>{row.message}</li>
      ))}
    </ul>
  )
}

interface ItemListPanelProps {
  /** `setup`: the Setup step "Item List". `settings`: re-importing later. */
  mode: 'setup' | 'settings'
  itemList: ItemListInfo | null
  /** Why an earlier Item List was not used, shown on the Setup step. */
  notice?: string | null
  onImported(info: ItemListInfo): void
  /** Setup only: go on once an Item List is in use. */
  onContinue?(): void
}

/** The Setup step "Item List", and the Item List section of Settings. */
export function ItemListPanel({ mode, itemList, notice = null, onImported, onContinue }: ItemListPanelProps): React.JSX.Element {
  const importer = useItemListImport(itemList, onImported)
  const setup = mode === 'setup'
  const importedHere = importer.state.status === 'done' && importer.state.outcome.status === 'imported'

  return (
    <section className="panel settings" aria-label="Item List">
      <h2>{setup ? 'Setup: Item List' : 'Item List'}</h2>
      <p className="settings__intro">
        {setup
          ? 'Import the Item List, the HA drug master file item_phq.txt. Every Item Code is checked against it. All PCs using this folder share it, so it is imported once for all of them.'
          : 'Shared by all PCs using this folder. Import a newer item_phq.txt when HA issues one.'}
      </p>
      {setup && notice && (
        <p className="message message--warning settings__notice" role="alert">
          ⚠ {notice}
        </p>
      )}

      {itemList && !(setup && importedHere) && <ItemListDetails info={itemList} />}

      <div className="actions">
        <button
          type="button"
          className={setup && !itemList ? 'button button--primary' : 'button button--secondary'}
          onClick={() => void importer.start()}
          disabled={importer.busy}
        >
          {importer.busy ? 'Importing…' : setup ? (itemList ? 'Import another file…' : 'Import Item List…') : 'Re-import Item List…'}
        </button>
        {setup && (
          <button type="button" className="button button--primary" onClick={onContinue} disabled={!itemList || importer.busy}>
            Continue
          </button>
        )}
      </div>
      <ImportOutcome state={importer.state} />
    </section>
  )
}

/** File, counts and who imported the Item List in use. */
function ItemListDetails({ info }: { info: ItemListInfo }): React.JSX.Element {
  return (
    <dl className="item-list-details">
      <dt>File</dt>
      <dd>
        {info.sourceFileName}, dated {formatFileDate(info.sourceModified)}
      </dd>
      <dt>Items</dt>
      <dd>
        {countOf(info.items, 'item')}, {countOf(info.liquids, 'liquid')}
      </dd>
      <dt>Imported</dt>
      <dd>
        {formatFileDate(info.importedAt)} {localTime(info.importedAt)} by {info.importedBy} on {info.pc}
      </dd>
    </dl>
  )
}

function localTime(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
