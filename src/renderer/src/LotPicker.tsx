import type { LotChoice, LotPicker as LotPickerState } from '../../core/lotPicker'

/** What the picker shows: the core's picker, or that the item's Lots are being read or could not be. */
export type LotPickerView = LotPickerState | { readonly status: 'loading' } | { readonly status: 'error'; readonly message: string }

interface LotPickerProps {
  view: LotPickerView
  /** The Lot picked (as recorded), `manual` for "Type lot manually", or null for neither yet. */
  selected: string | 'manual' | null
  onPick(choice: LotChoice): void
  onManual(): void
  /** Enter on a choice: picks it if it is not picked yet, then moves on. */
  onEnter(choice: LotChoice | 'manual'): void
  /** Offered when the Stock Onhand is not today's. */
  onImport(): void
  importing: boolean
  /** Shown under the stale message: the outcome of an import started here. */
  importOutcome?: React.ReactNode
  groupRef: React.Ref<HTMLDivElement>
}

/**
 * The Lot picker for an Item Code found in the Item List: the item's Lots in today's Stock Onhand,
 * earliest Expiry first, plus "Type lot manually"; or why there is nothing to pick.
 */
export function LotPicker({ view, selected, onPick, onManual, onEnter, onImport, importing, importOutcome, groupRef }: LotPickerProps): React.JSX.Element | null {
  switch (view.status) {
    case 'loading':
      return null
    case 'none':
    case 'no-lots':
      return <p className="lot-picker__note message message--hint">{view.message}</p>
    case 'error':
      return <p className="lot-picker__note message message--error">The Stock Onhand could not be read: {view.message}</p>
    case 'stale':
      return (
        <div className="lot-picker__note lot-picker__stale" role="status">
          <p className="message message--warning">⚠ {view.message}</p>
          <button type="button" className="button button--secondary button--small" onClick={onImport} disabled={importing}>
            {importing ? 'Importing…' : 'Import Stock Onhand…'}
          </button>
          {importOutcome}
        </div>
      )
    case 'choices':
      return (
        <fieldset className="lot-picker">
          <legend>Lot from today&apos;s Stock Onhand</legend>
          <div className="lot-picker__choices" role="radiogroup" aria-label="Lot from today's Stock Onhand" ref={groupRef}>
            {view.choices.map((choice) => {
              const pickable = choice.fill !== null
              const isSelected = selected === choice.lot
              const className = ['lot-choice', isSelected && 'lot-choice--selected', !pickable && 'lot-choice--disabled', `lot-choice--${choice.status}`]
                .filter(Boolean)
                .join(' ')
              return (
                <label key={choice.lot} className={className}>
                  <input
                    type="radio"
                    name="stockLot"
                    value={choice.lot}
                    checked={isSelected}
                    disabled={!pickable}
                    data-pickable={pickable ? 'true' : undefined}
                    onChange={() => onPick(choice)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      onEnter(choice)
                    }}
                  />
                  <span className="lot-choice__text">
                    <span className="lot-choice__lot">{choice.lot}</span>
                    <span className="lot-choice__sep"> · </span>
                    <span className="lot-choice__expiry">{choice.expiryText ?? 'no Expiry'}</span>
                    <span className="lot-choice__sep"> · </span>
                    <span className="lot-choice__qty">{choice.quantityText}</span>
                  </span>
                  {choice.message && (
                    <span className={choice.status === 'warning' ? 'lot-choice__note lot-choice__note--warning' : 'lot-choice__note lot-choice__note--error'}>
                      {choice.status === 'warning' ? '⚠ ' : choice.status === 'blocked' ? 'Blocked: ' : 'Cannot be picked: '}
                      {choice.message}
                    </span>
                  )}
                </label>
              )
            })}
            <label className={selected === 'manual' ? 'lot-choice lot-choice--manual lot-choice--selected' : 'lot-choice lot-choice--manual'}>
              <input
                type="radio"
                name="stockLot"
                value=""
                checked={selected === 'manual'}
                onChange={onManual}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  onEnter('manual')
                }}
              />
              <span className="lot-choice__text">Type lot manually</span>
            </label>
          </div>
        </fieldset>
      )
  }
}
