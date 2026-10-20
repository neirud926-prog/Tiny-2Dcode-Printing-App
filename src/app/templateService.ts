/**
 * Template saves, copies, renames and deletes behind `window.api`: everything the renderer sends is
 * checked again here (shape, name, layout on its Label Size), and every attempt is written to this
 * PC's template log.
 */
import { BUILT_IN_TEMPLATES, parseTemplate, type Template } from '../core/template'
import { errorText } from '../data/atomicWrite'
import { readLabelSizes } from '../data/labelSizeStore'
import { appendTemplateLog, type TemplateAction } from '../data/templateLog'
import { copyTemplate, deleteTemplate, readTemplates, renameTemplate, saveTemplate, type TemplateChange } from '../data/templateStore'
import type { TemplateChangeOutcome, TemplatesList } from '../preload/api'
import { templateProblems } from '../render/customLabel'

export interface TemplateContext {
  readonly dataFolder: string
  readonly pcName: string
  readonly windowsUser: string
  /** Where this PC's logs go now. */
  logFolder(): string
  now(): Date
}

/** The built-ins, then the saved Templates. */
export async function listTemplates(dataFolder: string): Promise<TemplatesList> {
  const read = await readTemplates(dataFolder)
  return read.ok ? { ok: true, templates: [...BUILT_IN_TEMPLATES, ...read.templates] } : read
}

export async function saveTemplateRequest(input: unknown, context: TemplateContext): Promise<TemplateChangeOutcome> {
  const template = parseTemplate(input)
  if (!template) return { ok: false, message: 'The template is not valid.' }
  const sizes = await readLabelSizes(context.dataFolder)
  const size = sizes.ok ? sizes.sizes.find((entry) => entry.id === template.labelSizeId) : undefined
  const changed: TemplateChange<Template> = !sizes.ok
    ? sizes
    : !size
      ? { ok: false, message: 'That label size is no longer in the list.' }
      : await saveTemplate(context.dataFolder, template, (checked, original) => templateProblems(checked, size, original).join(' ') || null)
  return logged(context, 'Save', changed.ok ? changed.value.name : template.name, changed, 'Saved')
}

export async function renameTemplateRequest(id: unknown, name: unknown, context: TemplateContext): Promise<TemplateChangeOutcome> {
  if (typeof id !== 'string' || typeof name !== 'string') return { ok: false, message: 'The request is not valid.' }
  const before = await nameOf(context.dataFolder, id)
  const changed = await renameTemplate(context.dataFolder, id, name)
  return logged(context, 'Rename', `${before} → ${changed.ok ? changed.value.name : name.trim()}`, changed, 'Renamed')
}

export async function copyTemplateRequest(id: unknown, name: unknown, context: TemplateContext): Promise<TemplateChangeOutcome> {
  if (typeof id !== 'string' || typeof name !== 'string') return { ok: false, message: 'The request is not valid.' }
  const before = await nameOf(context.dataFolder, id)
  const changed = await copyTemplate(context.dataFolder, id, name)
  return logged(context, 'Copy', `${before} → ${changed.ok ? changed.value.name : name.trim()}`, changed, 'Copied')
}

export async function deleteTemplateRequest(id: unknown, context: TemplateContext): Promise<TemplateChangeOutcome> {
  if (typeof id !== 'string') return { ok: false, message: 'The request is not valid.' }
  const before = await nameOf(context.dataFolder, id)
  const changed = await deleteTemplate(context.dataFolder, id)
  const outcome = await logged(context, 'Delete', changed.ok ? changed.value.name : before, changed, 'Deleted')
  return outcome.ok ? { ...outcome, template: null } : outcome
}

/** The Template's name, for the log (its id when it is not there). */
async function nameOf(dataFolder: string, id: string): Promise<string> {
  const list = await listTemplates(dataFolder)
  return (list.ok ? list.templates.find((template) => template.id === id)?.name : undefined) ?? id
}

/** Logs the change, then returns the Templates after it, or why it was refused. */
async function logged(context: TemplateContext, action: TemplateAction, template: string, changed: TemplateChange<Template>, done: string): Promise<TemplateChangeOutcome> {
  let warning: string | null = null
  try {
    const result = changed.ok ? done : `Refused: ${changed.message}`
    await appendTemplateLog(context.logFolder(), { at: context.now(), windowsUser: context.windowsUser, pcName: context.pcName, action, template, result })
  } catch (error) {
    warning = `The template log could not be written: ${errorText(error)}`
  }
  if (!changed.ok) return changed
  const list = await listTemplates(context.dataFolder)
  if (!list.ok) return list
  return { ok: true, templates: list.templates, template: changed.value, warning }
}
