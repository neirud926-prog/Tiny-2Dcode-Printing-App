/**
 * The Label Sizes in the data folder: `labelsizes.dat`, sealed, shared by every PC, holding the sizes
 * staff added. The Small Label is built in: always first, never stored, changed or deleted. Every
 * change is made holding the lock file `labelsizes.lock` (see `fileLock`), so two PCs never
 * overwrite each other's change. A damaged or changed `labelsizes.dat` is refused, never replaced.
 */
import { formatLabelSizeMm, normaliseLabelSize, SMALL_LABEL, type LabelSizeEntry } from '../render/printSettings'
import type { LabelSize } from '../render/labelSvg'
import { errorText } from './atomicWrite'
import { defaultLockDeps, withFileLock, type LockDeps } from './fileLock'
import { platform } from './platform'
import { readSealed, writeSealed } from './sealed'
import { readTemplates } from './templateStore'

export const LABEL_SIZES_FILE_NAME = 'labelsizes.dat'
export const LABEL_SIZES_LOCK_NAME = 'labelsizes.lock'

export function labelSizesPath(dataFolder: string): string {
  return platform().path.join(dataFolder, LABEL_SIZES_FILE_NAME)
}

function labelSizesLockPath(dataFolder: string): string {
  return platform().path.join(dataFolder, LABEL_SIZES_LOCK_NAME)
}

/**
 * Whether a stored Template is made for the Label Size, so it cannot be deleted. Templates that
 * cannot be read count as using every size, so none is deleted from under them.
 */
export async function isLabelSizeInUse(dataFolder: string, id: string): Promise<boolean> {
  const read = await readTemplates(dataFolder)
  return !read.ok || read.templates.some((template) => template.labelSizeId === id)
}

export type LabelSizesRead = { ok: true; sizes: LabelSizeEntry[] } | { ok: false; message: string }
export type LabelSizeChange<T> = { ok: true; value: T } | { ok: false; message: string }

/** The Label Sizes: the Small Label first, then those added, in the order added. */
export async function readLabelSizes(dataFolder: string): Promise<LabelSizesRead> {
  const read = await readSealed(labelSizesPath(dataFolder))
  switch (read.status) {
    case 'missing':
      return { ok: true, sizes: [SMALL_LABEL] }
    case 'tampered':
      return { ok: false, message: `The Label Sizes (${LABEL_SIZES_FILE_NAME}) were changed outside the app.` }
    case 'unreadable':
      return { ok: false, message: `The Label Sizes could not be used: ${read.message}` }
    case 'ok': {
      const sizes = asLabelSizes(read.value)
      return sizes ? { ok: true, sizes: [SMALL_LABEL, ...sizes] } : { ok: false, message: `The Label Sizes (${LABEL_SIZES_FILE_NAME}) are not a valid list.` }
    }
  }
}

/** Adds a Label Size (name, width, height), checked; its name must be new, ignoring case. */
export function addLabelSize(dataFolder: string, input: unknown, deps: LockDeps = defaultLockDeps): Promise<LabelSizeChange<LabelSizeEntry>> {
  const checked = normaliseLabelSize(input)
  if (!checked.ok) return Promise.resolve({ ok: false, message: checked.errors.map((error) => error.message).join(' ') })
  return changeLabelSizes(
    dataFolder,
    async (sizes) => {
      const taken = sizes.find((size) => size.name.toLowerCase() === checked.size.name.toLowerCase())
      if (taken) return { ok: false, message: `There is already a label size named "${taken.name}".` }
      const added: LabelSizeEntry = { id: crypto.randomUUID(), ...checked.size }
      return { ok: true, sizes: [...sizes, added], value: added }
    },
    deps
  )
}

/** Deletes an added Label Size, unless `isInUse` says a Template uses it. */
export function deleteLabelSize(
  dataFolder: string,
  id: string,
  isInUse: (id: string) => Promise<boolean>,
  deps: LockDeps = defaultLockDeps
): Promise<LabelSizeChange<null>> {
  if (id === SMALL_LABEL.id) return Promise.resolve({ ok: false, message: 'The Small Label is built in and cannot be deleted.' })
  return changeLabelSizes(
    dataFolder,
    async (sizes) => {
      const found = sizes.find((size) => size.id === id)
      if (!found) return { ok: false, message: 'That label size is no longer there; another PC may have deleted it.' }
      if (await isInUse(id)) return { ok: false, message: `The label size "${found.name}" is used by a Template and cannot be deleted.` }
      return { ok: true, sizes: sizes.filter((size) => size !== found), value: null }
    },
    deps
  )
}

/**
 * The Label Size with these dimensions: the Small Label, an existing size, or a new one named
 * "W × H mm" (for upgrading settings that saved only a width and height).
 */
export function ensureLabelSize(dataFolder: string, size: LabelSize, deps: LockDeps = defaultLockDeps): Promise<LabelSizeChange<LabelSizeEntry>> {
  return changeLabelSizes(
    dataFolder,
    async (sizes) => {
      const found = sizes.find((entry) => entry.widthMm === size.widthMm && entry.heightMm === size.heightMm)
      if (found) return { ok: true, sizes, value: found }
      const base = formatLabelSizeMm(size)
      let name = base
      for (let n = 2; sizes.some((entry) => entry.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} (${n})`
      const added: LabelSizeEntry = { id: crypto.randomUUID(), name, widthMm: size.widthMm, heightMm: size.heightMm }
      return { ok: true, sizes: [...sizes, added], value: added }
    },
    deps
  )
}

/**
 * Applies `change` to the Label Sizes (the Small Label first) under the lock and writes the sizes
 * after the Small Label. `change` refuses, or returns the new list and a value for the caller.
 */
async function changeLabelSizes<T>(
  dataFolder: string,
  change: (sizes: readonly LabelSizeEntry[]) => Promise<{ ok: true; sizes: readonly LabelSizeEntry[]; value: T } | { ok: false; message: string }>,
  deps: LockDeps
): Promise<LabelSizeChange<T>> {
  return withFileLock(labelSizesLockPath(dataFolder), 'The Label Sizes', deps, async () => {
    const current = await readLabelSizes(dataFolder)
    if (!current.ok) return current
    const changed = await change(current.sizes)
    if (!changed.ok) return changed
    if (changed.sizes !== current.sizes) {
      try {
        await writeSealed(
          labelSizesPath(dataFolder),
          changed.sizes.filter((size) => size.id !== SMALL_LABEL.id)
        )
      } catch (error) {
        return { ok: false, message: `The Label Sizes could not be saved: ${errorText(error)}` }
      }
    }
    return { ok: true, value: changed.value }
  })
}

function asLabelSizes(value: unknown): LabelSizeEntry[] | null {
  if (!Array.isArray(value)) return null
  const valid = value.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false
    const record = entry as Record<string, unknown>
    return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.widthMm === 'number' && typeof record.heightMm === 'number'
  })
  return valid ? (value as LabelSizeEntry[]) : null
}
