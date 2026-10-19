import { useCallback, useEffect, useRef, useState } from 'react'
import { formatExpiry, parseExpiry } from '../../core/expiry'
import { PACK_VOLUMES } from '../../core/internalGtin'
import type { PendingLabelView } from '../../core/pendingLabel'
import type { PendingLabelsList, PrintOutcome } from '../../preload/api'
import { OutcomeMessage } from './OutcomeMessage'

/** Pack Volume choices for a liquid saved without one: the listed volumes, then Other (digit 0). */
export const PACK_VOLUME_OPTIONS: readonly { digit: number; name: string }[] = [
  ...PACK_VOLUMES.filter((entry) => entry.ml !== null).map((entry) => ({ digit: entry.digit, name: `${entry.ml} mL` })),
  { digit: 0, name: 'Other' }
]

/**
 * The Pending Labels, read again whenever the Item List in use changes (`itemListStamp`): that is
 * the recheck after every import. `announce` turns true when a recheck found a Pending Label ready
 * that was not ready before.
 */
export function usePendingLabels(itemListStamp: string) {
  const [list, setList] = useState<PendingLabelsList | null>(null)
  const [announce, setAnnounce] = useState(false)
  const readyIds = useRef<ReadonlySet<string> | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    let answer: PendingLabelsList
    try {
      answer = await window.api.listPendingLabels()
    } catch (error) {
      answer = { ok: false, message: String(error) }
    }
    const ready = new Set(answer.ok ? answer.labels.filter((label) => label.status === 'ready').map((label) => label.id) : [])
    if (readyIds.current && [...ready].some((id) => !readyIds.current?.has(id))) setAnnounce(true)
    readyIds.current = ready
    setList(answer)
  }, [])

  useEffect(() => {
    void refresh()
  }, [itemListStamp, refresh])

  const labels = list?.ok ? list.labels : []
  return { list, refresh, announce, clearAnnounce: () => setAnnounce(false), total: labels.length, ready: labels.filter((label) => label.status === 'ready').length }
}

interface PendingLabelsDialogProps {
  list: PendingLabelsList | null
  refresh(): Promise<void>
  onClose(): void
}

/** The Pending Labels: the ones now in the Item List print with one click; any can be deleted. */
export function PendingLabelsDialog({ list, refresh, onClose }: PendingLabelsDialogProps): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<PrintOutcome | null>(null)
  /** Pack Volume chosen here for a liquid saved without one, by Pending Label. */
  const [volumes, setVolumes] = useState<Readonly<Record<string, number>>>({})

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    void refresh()
    return () => element?.close()
  }, [refresh])

  async function run(id: string, task: () => Promise<PrintOutcome>): Promise<void> {
    if (busy) return
    setBusy(id)
    setOutcome(null)
    try {
      setOutcome(await task())
    } catch (error) {
      setOutcome({ ok: false, message: String(error) })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  const print = (label: PendingLabelView): Promise<void> => run(label.id, () => window.api.printPendingLabel(label.id, label.packVolumeDigit ?? volumes[label.id] ?? null))
  const remove = (label: PendingLabelView): Promise<void> =>
    run(label.id, async () => {
      const deleted = await window.api.deletePendingLabel(label.id)
      return deleted.ok ? { ok: true, message: `Deleted the Pending Label for ${label.itemCode}.`, warning: null } : deleted
    })

  const labels = list?.ok ? list.labels : []
  return (
    <dialog
      ref={dialog}
      className="dialog dialog--wide"
      aria-labelledby="pending-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <h2 id="pending-title" className="dialog__title">
        Pending Labels
      </h2>
      <p>Requests saved for Item Codes that were not in the Item List. Those now listed can be printed; the rest wait for a newer Item List.</p>
      {list && !list.ok && <p className="message message--error dialog__still">{list.message}</p>}
      {list?.ok && labels.length === 0 && <p className="pending__empty">There are no Pending Labels.</p>}
      {labels.length > 0 && (
        <ul className="pending">
          {labels.map((label) => {
            const expiry = parseExpiry(label.expiry)
            const needsVolume = label.status === 'ready' && label.liquid && label.packVolumeDigit === null
            const chosen = volumes[label.id]
            return (
              <li key={label.id} className={label.status === 'ready' ? 'pending__row pending__row--ready' : 'pending__row'}>
                <div className="pending__main">
                  <code>{label.itemCode}</code>
                  <span className={label.status === 'ready' ? 'pending__status pending__status--ready' : 'pending__status'}>
                    {label.status === 'ready' ? `Ready · ${label.itemName}` : 'Waiting for the Item List'}
                  </span>
                </div>
                <div className="pending__detail">
                  Expiry {expiry.ok ? formatExpiry(expiry.expiry) : label.expiry} · Lot {label.lot} · {label.copies} {label.copies === 1 ? 'copy' : 'copies'}
                  {label.packVolumeDigit ? ` · ${PACK_VOLUME_OPTIONS.find((option) => option.digit === label.packVolumeDigit)?.name}` : ''}
                  <br />
                  Saved {label.savedAt.slice(0, 10)} by {label.savedBy} on {label.pc}
                </div>
                <div className="pending__actions">
                  {needsVolume && (
                    <select
                      aria-label={`Pack Volume for ${label.itemCode}`}
                      value={chosen === undefined ? '' : String(chosen)}
                      onChange={(event) => setVolumes((previous) => ({ ...previous, [label.id]: Number(event.target.value) }))}
                    >
                      <option value="" disabled>
                        Pack Volume…
                      </option>
                      {PACK_VOLUME_OPTIONS.map((option) => (
                        <option key={option.digit} value={option.digit}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={label.status !== 'ready' || busy !== null || (needsVolume && chosen === undefined)}
                    onClick={() => void print(label)}
                  >
                    {busy === label.id ? 'Working…' : 'Print'}
                  </button>
                  <button type="button" className="button button--secondary button--small" disabled={busy !== null} onClick={() => void remove(label)}>
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <OutcomeMessage outcome={outcome} />
      <div className="dialog__footer">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy !== null} autoFocus>
          Close
        </button>
      </div>
    </dialog>
  )
}
