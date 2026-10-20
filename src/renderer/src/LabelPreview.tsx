import { useMemo } from 'react'
import type { BuildLabelResult, LabelField } from '../../core/label'
import { DEFAULT_LABEL_SIZE, renderLabelSvg, type LabelSize } from '../../render/labelSvg'

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
  size?: LabelSize
}

/** The label at real proportions, and the self-check line saying what its data decodes to. */
export function LabelPreview({ result, size = DEFAULT_LABEL_SIZE }: LabelPreviewProps): React.JSX.Element {
  const svg = useMemo(() => (result.ok ? renderLabelSvg(result.label, size) : null), [result, size])

  return (
    <section className="panel preview" aria-label="Label preview">
      <h2>Preview</h2>
      <LabelFrame svg={svg} size={size} />
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
