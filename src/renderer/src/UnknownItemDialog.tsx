import { useEffect, useRef, useState } from 'react'
import { formatFileDate, type ItemListInfo } from '../../core/itemList'
import { ImportOutcome, useItemListImport } from './ItemListImport'
import { PACK_VOLUME_CHOICES } from './packVolumeChoices'

interface UnknownItemDialogProps {
  itemCode: string
  itemList: ItemListInfo
  onImported(info: ItemListInfo): void
  /** Looks the Item Code up again (after an import); the screen closes the dialog if it is found. */
  recheck(): Promise<'found' | 'unknown' | null>
  /** Why the request cannot be saved as a Pending Label yet (an incomplete label), or null if it can. */
  saveBlocked: string | null
  /** Saves the request as a Pending Label; the screen closes the dialog when it is saved. */
  onSavePending(packVolumeDigit: number | null): Promise<{ ok: boolean; message: string }>
  /** Back to the Item Code field. */
  onClose(): void
}

/**
 * An Item Code that is not in the Item List: import a newer Item List, or save the request as a
 * Pending Label. There is no "print anyway".
 */
export function UnknownItemDialog({ itemCode, itemList, onImported, recheck, saveBlocked, onSavePending, onClose }: UnknownItemDialogProps): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const importer = useItemListImport(itemList, onImported)
  const [stillUnknown, setStillUnknown] = useState<ItemListInfo | null>(null)
  /** The Pack Volume, if staff know the item is a liquid (the Item List cannot say yet). */
  const [packVolume, setPackVolume] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  async function importNewer(): Promise<void> {
    setStillUnknown(null)
    const outcome = await importer.start()
    if (outcome?.status !== 'imported') return
    if ((await recheck()) === 'unknown') setStillUnknown(outcome.info)
  }

  async function savePending(): Promise<void> {
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await onSavePending(packVolume)
      if (!saved.ok) setSaveError(saved.message)
    } catch (error) {
      setSaveError(String(error))
    } finally {
      setSaving(false)
    }
  }

  const busy = importer.busy || saving
  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="unknown-item-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <h2 id="unknown-item-title" className="dialog__title">
        <code>{itemCode}</code> is not in the Item List
      </h2>
      <p>
        The Item List in use is dated {formatFileDate(itemList.sourceModified)}. If this is a new item, import a newer Item List. A label for an Item
        Code that is not in the Item List cannot be printed.
      </p>
      {stillUnknown && (
        <p className="message message--error dialog__still">
          {itemCode} is not in the newer Item List (file dated {formatFileDate(stillUnknown.sourceModified)}) either. Check the Item Code.
        </p>
      )}
      <ImportOutcome state={importer.state} />

      <div className="dialog__choices">
        <button type="button" className="button button--primary" onClick={() => void importNewer()} disabled={busy} autoFocus>
          {importer.busy ? 'Importing…' : 'Import a newer Item List…'}
        </button>
        <div className="dialog__choice">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void savePending()}
            disabled={busy || saveBlocked !== null}
            aria-describedby="pending-label-note"
          >
            {saving ? 'Saving…' : 'Save as Pending Label'}
          </button>
          <span id="pending-label-note" className="dialog__note">
            {saveBlocked ?? 'Keeps this label until an Item List with this Item Code is imported.'}
          </span>
        </div>
      </div>
      <div className="dialog__volume">
        <label htmlFor="pending-pack-volume">If it is a liquid, Pack Volume for the Pending Label</label>
        <select
          id="pending-pack-volume"
          value={packVolume === null ? '' : String(packVolume)}
          onChange={(event) => setPackVolume(event.target.value === '' ? null : Number(event.target.value))}
          disabled={busy}
        >
          <option value="">Not a liquid / not sure</option>
          {PACK_VOLUME_CHOICES.map((choice) => (
            <option key={choice.digit} value={choice.digit}>
              {choice.name}
            </option>
          ))}
        </select>
      </div>
      {saveError && (
        <p className="message message--error dialog__still" role="alert">
          {saveError}
        </p>
      )}
      <div className="dialog__footer">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
          Change Item Code
        </button>
      </div>
    </dialog>
  )
}
