import { useEffect, useRef, useState } from 'react'
import { markdownToHtml } from '../../app/markdown'
import guideMarkdown from '../../../docs/brother-p900w-setup.md?raw'

/** The guide's drawings, bundled with it so it shows offline; keyed as the guide names them. */
const drawings = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../../docs/brother-p900w/*.svg', { query: '?raw', import: 'default', eager: true })).map(([path, svg]) => [
    path.replace('../../../docs/', ''),
    svg
  ])
)

/** The Brother PT-P900W guide as HTML, made once from the bundled `docs/brother-p900w-setup.md`. */
let guideHtml: string | null = null

/** "How to set the printer": opens the Brother PT-P900W guide in a dialog. */
export function PrinterGuideLink(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        How to set the printer
      </button>
      {open && <PrinterGuideDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function PrinterGuideDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  guideHtml ??= markdownToHtml(guideMarkdown, drawings)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="dialog dialog--wide"
      aria-label="How to set the printer"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="printer-guide" dangerouslySetInnerHTML={{ __html: guideHtml }} />
      <div className="dialog__footer">
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  )
}
