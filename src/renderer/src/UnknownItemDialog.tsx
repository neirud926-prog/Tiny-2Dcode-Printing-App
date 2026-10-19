import { useEffect, useRef, useState } from 'react'
import { formatFileDate, type ItemListInfo } from '../../core/itemList'
import { ImportOutcome, useItemListImport } from './ItemListImport'

interface UnknownItemDialogProps {
  itemCode: string
  itemList: ItemListInfo
  onImported(info: ItemListInfo): void
  /** Looks the Item Code up again (after an import); the screen closes the dialog if it is found. */
  recheck(): Promise<'found' | 'unknown' | null>
  /** Back to the Item Code field. */
  onClose(): void
}

/**
 * An Item Code that is not in the Item List: import a newer Item List, or (from ticket #7) save the
 * request as a Pending Label. There is no "print anyway".
 */
export function UnknownItemDialog({ itemCode, itemList, onImported, recheck, onClose }: UnknownItemDialogProps): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const importer = useItemListImport(itemList, onImported)
  const [stillUnknown, setStillUnknown] = useState<ItemListInfo | null>(null)

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

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="unknown-item-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!importer.busy) onClose()
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
        <button type="button" className="button button--primary" onClick={() => void importNewer()} disabled={importer.busy} autoFocus>
          {importer.busy ? 'Importing…' : 'Import a newer Item List…'}
        </button>
        <div className="dialog__choice">
          <button type="button" className="button button--secondary" disabled aria-describedby="pending-label-note">
            Save as Pending Label
          </button>
          <span id="pending-label-note" className="dialog__note">
            Coming soon
          </span>
        </div>
      </div>
      <div className="dialog__footer">
        <button type="button" className="button button--secondary" onClick={onClose} disabled={importer.busy}>
          Change Item Code
        </button>
      </div>
    </dialog>
  )
}
