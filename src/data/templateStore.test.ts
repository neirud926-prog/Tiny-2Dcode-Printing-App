import { readdir, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { LAYOUT_1, LAYOUT_2, type Template } from '../core/template'
import type { LockDeps } from './fileLock'
import { isLabelSizeInUse } from './labelSizeStore'
import { copyTemplate, deleteTemplate, readTemplates, renameTemplate, saveTemplate, templatesPath, type TemplateCheck } from './templateStore'
import { tempFolder } from './testFolder'

/** Real timers, a tenth of the usual waits, so a held lock is waited out for real. */
const realDeps: LockDeps = { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / 10)) }
const anyLayout: TemplateCheck = () => null

/** A new Template (no id yet) on the Shelf size. */
function draft(name: string, labelSizeId = 'shelf'): Template {
  return { ...LAYOUT_1, id: '', name, labelSizeId, builtIn: false }
}

async function stored(folder: string): Promise<Template[]> {
  const read = await readTemplates(folder)
  if (!read.ok) throw new Error(read.message)
  return read.templates
}

async function saved(folder: string, template: Template, deps?: LockDeps): Promise<Template> {
  const result = await saveTemplate(folder, template, anyLayout, null, deps)
  if (!result.ok) throw new Error(result.message)
  return result.value
}

describe('Templates store', () => {
  it('stores nothing until a Template is saved; the built-ins are never stored', async () => {
    const folder = await tempFolder()
    expect(await readTemplates(folder)).toEqual({ ok: true, templates: [] })
    expect(await readdir(folder)).toEqual([])
  })

  it('creates a Template with a new id, then updates it by its id', async () => {
    const folder = await tempFolder()
    const created = await saved(folder, draft('Shelf bin'))
    expect(created.id).not.toBe('')
    expect(created).toMatchObject({ name: 'Shelf bin', builtIn: false, labelSizeId: 'shelf' })
    expect(await readdir(folder)).toEqual(['templates.dat'])
    const updated = await saved(folder, { ...created, code: { ...created.code, dotsPerModule: 4 } })
    expect(await stored(folder)).toEqual([updated])
    expect(updated.code.dotsPerModule).toBe(4)
    expect(await saveTemplate(folder, { ...created, id: 'gone' }, anyLayout)).toEqual({ ok: false, message: expect.stringContaining('no longer there') })
  })

  it('checks the layout against the stored version, and refuses what the check refuses', async () => {
    const folder = await tempFolder()
    const created = await saved(folder, draft('Shelf bin'))
    const seen: (Template | null)[] = []
    const check: TemplateCheck = (_template, original) => {
      seen.push(original)
      return 'Line 1 overlaps the code.'
    }
    expect(await saveTemplate(folder, created, check)).toEqual({ ok: false, message: 'Line 1 overlaps the code.' })
    expect(await saveTemplate(folder, draft('New'), check)).toEqual({ ok: false, message: 'Line 1 overlaps the code.' })
    expect(seen).toEqual([created, null])
    expect(await stored(folder)).toEqual([created])
  })

  it('keeps names unique ignoring case, the built-ins included, and trimmed', async () => {
    const folder = await tempFolder()
    const bin = await saved(folder, draft('  Shelf bin '))
    expect(bin.name).toBe('Shelf bin')
    expect(await saveTemplate(folder, draft('SHELF BIN'), anyLayout)).toEqual({ ok: false, message: 'There is already a template named "Shelf bin".' })
    expect(await saveTemplate(folder, draft('layout 1'), anyLayout)).toEqual({ ok: false, message: 'There is already a template named "Layout 1".' })
    expect(await saveTemplate(folder, draft(' '), anyLayout)).toEqual({ ok: false, message: 'Enter a name for the template.' })
    expect(await saveTemplate(folder, draft('x'.repeat(41)), anyLayout)).toEqual({ ok: false, message: 'The template name must be at most 40 characters.' })
    // Its own name, in another case, is not taken.
    expect((await saveTemplate(folder, { ...bin, name: 'SHELF BIN' }, anyLayout)).ok).toBe(true)
    const other = await saved(folder, draft('Other'))
    expect(await renameTemplate(folder, other.id, 'shelf bin')).toEqual({ ok: false, message: 'There is already a template named "SHELF BIN".' })
    expect(await copyTemplate(folder, other.id, 'Layout 2')).toEqual({ ok: false, message: 'There is already a template named "Layout 2".' })
  })

  it('keeps the built-ins read-only, but copyable', async () => {
    const folder = await tempFolder()
    const readOnly = 'Layout 1 is built in and cannot be changed. Copy it to make your own.'
    expect(await saveTemplate(folder, { ...LAYOUT_1, name: 'Mine' }, anyLayout)).toEqual({ ok: false, message: readOnly })
    expect(await renameTemplate(folder, LAYOUT_1.id, 'Mine')).toEqual({ ok: false, message: readOnly })
    expect(await deleteTemplate(folder, LAYOUT_1.id)).toEqual({ ok: false, message: readOnly })
    const copy = await copyTemplate(folder, LAYOUT_2.id, 'My layout')
    if (!copy.ok) throw new Error(copy.message)
    expect(copy.value).toEqual({ ...LAYOUT_2, id: copy.value.id, name: 'My layout', builtIn: false })
    expect(copy.value.id).not.toBe(LAYOUT_2.id)
    expect(await stored(folder)).toEqual([copy.value])
  })

  it('renames, copies and deletes a stored Template', async () => {
    const folder = await tempFolder()
    const bin = await saved(folder, draft('Shelf bin'))
    const renamed = await renameTemplate(folder, bin.id, 'Bin')
    expect(renamed).toEqual({ ok: true, value: { ...bin, name: 'Bin' } })
    const copy = await copyTemplate(folder, bin.id, 'Bin 2')
    expect(copy).toEqual({ ok: true, value: { ...bin, id: expect.any(String), name: 'Bin 2' } })
    expect(await deleteTemplate(folder, bin.id)).toEqual({ ok: true, value: { ...bin, name: 'Bin' } })
    expect((await stored(folder)).map((template) => template.name)).toEqual(['Bin 2'])
    expect(await deleteTemplate(folder, bin.id)).toEqual({ ok: false, message: expect.stringContaining('no longer there') })
  })

  it('is shared: saves, renames and deletes at the same time on two PCs are all kept', async () => {
    const folder = await tempFolder()
    const [keep, gone] = [await saved(folder, draft('Keep')), await saved(folder, draft('Gone'))]
    const pcOne = Promise.all([0, 1, 2].map((i) => saveTemplate(folder, draft(`PC1 ${i}`), anyLayout, null, realDeps)))
    const pcTwo = Promise.all([0, 1, 2].map((i) => saveTemplate(folder, draft(`PC2 ${i}`), anyLayout, null, realDeps)))
    const [one, two, renamed, deleted] = await Promise.all([pcOne, pcTwo, renameTemplate(folder, keep.id, 'Kept', realDeps), deleteTemplate(folder, gone.id, realDeps)])
    expect([...one, ...two, renamed, deleted].every((result) => result.ok)).toBe(true)
    expect((await stored(folder)).map((template) => template.name).sort()).toEqual(['Kept', 'PC1 0', 'PC1 1', 'PC1 2', 'PC2 0', 'PC2 1', 'PC2 2'])
  })

  it('makes a Label Size in use while a stored Template is made for it', async () => {
    const folder = await tempFolder()
    expect(await isLabelSizeInUse(folder, 'shelf')).toBe(false)
    const bin = await saved(folder, draft('Shelf bin', 'shelf'))
    expect(await isLabelSizeInUse(folder, 'shelf')).toBe(true)
    expect(await isLabelSizeInUse(folder, 'bag')).toBe(false)
    await deleteTemplate(folder, bin.id)
    expect(await isLabelSizeInUse(folder, 'shelf')).toBe(false)
  })

  it('refuses to use or change a file changed outside the app, and counts its sizes as in use', async () => {
    const folder = await tempFolder()
    await writeFile(templatesPath(folder), 'not a sealed file')
    expect(await readTemplates(folder)).toEqual({ ok: false, message: 'The Templates (templates.dat) were changed outside the app.' })
    expect(await saveTemplate(folder, draft('Shelf bin'), anyLayout)).toEqual({ ok: false, message: expect.stringContaining('changed outside the app') })
    expect(await isLabelSizeInUse(folder, 'shelf')).toBe(true)
  })

  it('refuses to save over a version another PC changed since it was opened', async () => {
    const folder = await tempFolder()
    const opened = await saved(folder, draft('Fridge'))
    expect((await renameTemplate(folder, opened.id, 'Fridge 2')).ok).toBe(true)
    expect(await saveTemplate(folder, { ...opened, name: 'Fridge' }, anyLayout, opened)).toEqual({
      ok: false,
      message: 'This template was changed on another PC; open it again.'
    })
    const listed = await readTemplates(folder)
    expect(listed.ok && listed.templates.map((t) => t.name)).toEqual(['Fridge 2'])
  })
})
