/**
 * Per-PC settings, sealed, in `pcs/<PC name>.dat`: each PC keeps its own printer, label size,
 * offsets and log folder, while the rest of the data folder is shared.
 */

import { normalisePcSettings, type PcSettings } from '../render/printSettings'
import { platform } from './platform'
import { readSealed, writeSealed } from './sealed'

/**
 * The PC name used for this PC's settings file and logs: the host name before any domain,
 * upper-cased (Windows names are case-insensitive), with anything but A–Z 0–9 `-` `_` replaced.
 */
export function pcNameFromHostname(hostname: string): string {
  const name = (hostname.split('.')[0] ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 63)
  return name === '' ? 'UNKNOWN-PC' : name
}

export function pcSettingsPath(dataFolder: string, pcName: string): string {
  return platform().path.join(dataFolder, 'pcs', `${pcName}.dat`)
}

export function defaultLogFolder(dataFolder: string): string {
  return platform().path.join(dataFolder, 'logs')
}

/** Where this PC's logs go. */
export function resolveLogFolder(dataFolder: string, settings: Pick<PcSettings, 'logFolder'>): string {
  return settings.logFolder ?? defaultLogFolder(dataFolder)
}

export type LoadPcSettingsResult =
  | { status: 'ok'; settings: PcSettings }
  | { status: 'missing' }
  | { status: 'tampered'; message: string }
  | { status: 'unreadable'; message: string }

export async function loadPcSettings(dataFolder: string, pcName: string): Promise<LoadPcSettingsResult> {
  const file = `${pcName}.dat`
  const read = await readSealed(pcSettingsPath(dataFolder, pcName))
  switch (read.status) {
    case 'missing':
      return read
    case 'tampered':
      return { status: 'tampered', message: `This PC's printer settings (${file}) were changed outside the app.` }
    case 'unreadable':
      return { status: 'unreadable', message: `This PC's printer settings could not be used: ${read.message}` }
    case 'ok': {
      const normalised = normalisePcSettings(read.value)
      if (normalised.ok) return { status: 'ok', settings: normalised.settings }
      return { status: 'unreadable', message: `This PC's printer settings (${file}) are not valid settings.` }
    }
  }
}

/** Validates and saves this PC's settings. Throws if they are not valid or cannot be written. */
export async function savePcSettings(dataFolder: string, pcName: string, settings: PcSettings): Promise<PcSettings> {
  const normalised = normalisePcSettings(settings)
  if (!normalised.ok) throw new Error(normalised.errors.map((error) => error.message).join(' '))
  await writeSealed(pcSettingsPath(dataFolder, pcName), normalised.settings)
  return normalised.settings
}
