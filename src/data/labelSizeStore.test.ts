import { readdir, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { SMALL_LABEL } from '../render/printSettings'
import type { LockDeps } from './fileLock'
import { addLabelSize, deleteLabelSize, ensureLabelSize, labelSizesPath, readLabelSizes } from './labelSizeStore'
import { tempFolder } from './testFolder'

/** Real timers, a tenth of the usual waits, so a held lock is waited out for real. */
const realDeps: LockDeps = { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / 10)) }
const notInUse = async (): Promise<boolean> => false

async function names(folder: string): Promise<string[]> {
  const read = await readLabelSizes(folder)
  if (!read.ok) throw new Error(read.message)
  return read.sizes.map((size) => size.name)
}

describe('Label Sizes store', () => {
  it('has only the Small Label, 34.4 × 25 mm, before any size is added, and stores nothing for it', async () => {
    const folder = await tempFolder()
    expect(await readLabelSizes(folder)).toEqual({ ok: true, sizes: [{ id: 'small-label', name: 'Small Label', widthMm: 34.4, heightMm: 25 }] })
    expect(await readdir(folder)).toEqual([])
  })

  it('adds a size after the Small Label, checked and rounded', async () => {
    const folder = await tempFolder()
    const added = await addLabelSize(folder, { name: '  Shelf 50x30 ', widthMm: 50.004, heightMm: 30 })
    if (!added.ok) throw new Error(added.message)
    expect(added.value).toMatchObject({ name: 'Shelf 50x30', widthMm: 50, heightMm: 30 })
    expect(await readLabelSizes(folder)).toEqual({ ok: true, sizes: [SMALL_LABEL, added.value] })
    expect(await readdir(folder)).toEqual(['labelsizes.dat'])
  })

  it('refuses a size outside the label size limits or without a name', async () => {
    const folder = await tempFolder()
    expect(await addLabelSize(folder, { name: 'Huge', widthMm: 151, heightMm: 30 })).toEqual({ ok: false, message: 'Label width must be from 10 to 150 mm.' })
    expect(await addLabelSize(folder, { name: ' ', widthMm: 50, heightMm: 30 })).toEqual({ ok: false, message: 'Enter a name for the label size.' })
    expect(await names(folder)).toEqual(['Small Label'])
  })

  it('keeps names unique ignoring case, the Small Label included', async () => {
    const folder = await tempFolder()
    expect((await addLabelSize(folder, { name: 'Shelf', widthMm: 50, heightMm: 30 })).ok).toBe(true)
    expect(await addLabelSize(folder, { name: 'SHELF', widthMm: 60, heightMm: 40 })).toEqual({ ok: false, message: 'There is already a label size named "Shelf".' })
    expect(await addLabelSize(folder, { name: 'small label', widthMm: 60, heightMm: 40 })).toEqual({
      ok: false,
      message: 'There is already a label size named "Small Label".'
    })
    expect(await names(folder)).toEqual(['Small Label', 'Shelf'])
  })

  it('never deletes the Small Label', async () => {
    const folder = await tempFolder()
    expect(await deleteLabelSize(folder, SMALL_LABEL.id, notInUse)).toEqual({ ok: false, message: 'The Small Label is built in and cannot be deleted.' })
    expect(await names(folder)).toEqual(['Small Label'])
  })

  it('deletes an added size unless it is in use', async () => {
    const folder = await tempFolder()
    const added = await addLabelSize(folder, { name: 'Shelf', widthMm: 50, heightMm: 30 })
    if (!added.ok) throw new Error(added.message)
    expect(await deleteLabelSize(folder, added.value.id, async () => true)).toEqual({
      ok: false,
      message: 'The label size "Shelf" is used by a Template and cannot be deleted.'
    })
    expect(await deleteLabelSize(folder, added.value.id, notInUse)).toEqual({ ok: true, value: null })
    expect(await names(folder)).toEqual(['Small Label'])
    expect(await deleteLabelSize(folder, added.value.id, notInUse)).toEqual({ ok: false, message: expect.stringContaining('no longer there') })
  })

  it('is shared: sizes added at the same time on two PCs are all kept', async () => {
    const folder = await tempFolder()
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => addLabelSize(folder, { name: `Size ${index}`, widthMm: 40 + index, heightMm: 30 }, realDeps)))
    expect(results.every((result) => result.ok)).toBe(true)
    expect((await names(folder)).sort()).toEqual(['Size 0', 'Size 1', 'Size 2', 'Size 3', 'Size 4', 'Size 5', 'Small Label'])
  })

  it('ensures a size by its dimensions: the Small Label, an existing one, or a new "W × H mm"', async () => {
    const folder = await tempFolder()
    expect(await ensureLabelSize(folder, { widthMm: 34.4, heightMm: 25 })).toEqual({ ok: true, value: SMALL_LABEL })
    const added = await ensureLabelSize(folder, { widthMm: 50, heightMm: 30.5 })
    expect(added).toEqual({ ok: true, value: expect.objectContaining({ name: '50 × 30.5 mm', widthMm: 50, heightMm: 30.5 }) })
    expect(await ensureLabelSize(folder, { widthMm: 50, heightMm: 30.5 })).toEqual(added)
    expect(await names(folder)).toEqual(['Small Label', '50 × 30.5 mm'])
  })

  it('refuses to change a list that was changed outside the app', async () => {
    const folder = await tempFolder()
    await writeFile(labelSizesPath(folder), 'not a sealed file')
    expect(await readLabelSizes(folder)).toEqual({ ok: false, message: 'The Label Sizes (labelsizes.dat) were changed outside the app.' })
    expect(await addLabelSize(folder, { name: 'Shelf', widthMm: 50, heightMm: 30 })).toEqual({ ok: false, message: expect.stringContaining('changed outside the app') })
  })
})
