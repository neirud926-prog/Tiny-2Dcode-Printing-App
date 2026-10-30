import { useMemo } from 'react'
import type { BuildLabelResult, LabelField } from '../../core/label'
import type { PrinterResolution } from '../../render/dataMatrix'
import { renderGtinLabelSvg } from '../../render/gtinTapeLabel'
import type { LabelSize } from '../../render/labelSvg'
import type { FitSize } from '../../render/printSettings'

/** The preview shows the label this many times its printed size (shrinking if the window is narrow). */
const PREVIEW_SCALE = 4

const FIELD_NAMES: Record<LabelField, string> = {
  itemCode: 'Item Code',
  packVolume: 'Pack Volume',
  expiry: 'Expiry',
  lot: 'Lot',
  copies: 'Copies',
  selfCheck: 'self-check'
}

interface LabelPreviewProps {
  result: BuildLabelResult
  /** The Label Size loaded in this PC's printer (on tape, the GTIN tape layout); null while the list is read. */
  size: FitSize | null
  /** This PC's Printer resolution, which sizes the code's modules. */
  dpi: PrinterResolution
  /** Why the label would not print on the loaded size, if it would not. */
  sizeProblem?: string | null
}

/** The label as it will print, at real proportions, and the self-check line saying what its data decodes to. */
export function LabelPreview({ result, size, dpi, sizeProblem = null }: LabelPreviewProps): React.JSX.Element {
  const svg = useMemo(() => (result.ok && size ? renderGtinLabelSvg(result.label, size, dpi) : null), [result, size, dpi])

  return (
    <section className="panel preview" aria-label="Label preview">
      <h2>Preview</h2>
      {size && <LabelFrame svg={svg} size={size} />}
      {sizeProblem && <p className="message message--warning">{sizeProblem}</p>}
      <SelfCheckLine result={result} />
      {result.ok && (
        <p className="gs1-data">
          GS1 data <code>{result.label.hri}</code>
        </p>
      )}
    </section>
  )
}

/** A label SVG at real proportions, enlarged, with its size under it; a note while there is none. */
export function LabelFrame({ svg, size }: { svg: string | null; size: LabelSize }): React.JSX.Element {
  const frameStyle = { width: `${size.widthMm * PREVIEW_SCALE}mm`, aspectRatio: `${size.widthMm} / ${size.heightMm}` }
  return (
    <>
      <div className="label-frame" style={frameStyle}>
        {svg ? (
          // The SVG is built by our renderer from validated label data (no user markup reaches it).
          <div className="label-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="label-empty">The label appears here when the form is complete.</p>
        )}
      </div>
      <p className="preview-caption">
        {size.widthMm} × {size.heightMm} mm label, enlarged
      </p>
    </>
  )
}

function SelfCheckLine({ result }: { result: BuildLabelResult }): React.JSX.Element {
  if (result.ok) {
    const { decoded } = result
    const packVolume = decoded.packVolumeMl === null ? '' : ` ${decoded.packVolumeMl} mL`
    return (
      <p className="self-check self-check--ok" role="status">
        ✓ Decodes to {decoded.itemCode}
        {packVolume} · EXP {decoded.expiryText} · LOT {decoded.lot}
      </p>
    )
  }
  const selfCheckError = result.errors.find((error) => error.field === 'selfCheck')
  const fields = [...new Set(result.errors.map((error) => FIELD_NAMES[error.field]))]
  return (
    <p className="self-check self-check--fail" role="status">
      ✗ {selfCheckError ? selfCheckError.message : `Not printable: check ${fields.join(', ')}.`}
    </p>
  )
}
