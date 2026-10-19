import { PACK_VOLUMES, type PackVolumeDigit } from '../../core/internalGtin'

/** The Pack Volume choices for a liquid, in mL: the listed volumes, then Other (digit 0, no volume encoded). */
export const PACK_VOLUME_CHOICES: readonly { digit: PackVolumeDigit; label: string; name: string }[] = [
  ...PACK_VOLUMES.filter((entry) => entry.ml !== null).map((entry) => ({ digit: entry.digit, label: String(entry.ml), name: `${entry.ml} mL` })),
  { digit: 0, label: 'Other', name: 'Other volume' }
]
