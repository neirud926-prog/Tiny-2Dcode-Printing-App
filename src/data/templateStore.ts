/**
 * The Templates staff made, in the data folder: `templates.dat`, sealed, shared by every PC. The
 * built-in Layouts 1 and 2 are never stored, changed or deleted, but count for name uniqueness and
 * may be copied. Every change is made holding the lock file `templates.lock` (see `fileLock`), so
 * two PCs never overwrite each other's change. A damaged or changed `templates.dat` is refused,
 * never replaced.
 */
import { BUILT_IN_TEMPLATES, normaliseTemplateName, parseTemplate, type Template } from '../core/template'
import { errorText } from './atomicWrite'
import { defaultLockDeps, withFileLock, type LockDeps } from './fileLock'
import { platform } from './platform'
import { readSealed, writeSealed } from './sealed'

export const TEMPLATES_FILE_NAME = 'templates.dat'
export const TEMPLATES_LOCK_NAME = 'templates.lock'

export function templatesPath(dataFolder: string): string {
  return platform().path.join(dataFolder, TEMPLATES_FILE_NAME)
}

function templatesLockPath(dataFolder: string): string {
  return platform().path.join(dataFolder, TEMPLATES_LOCK_NAME)
}

export type TemplatesRead = { ok: true; templates: Template[] } | { ok: false; message: string }
export type TemplateChange<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * Checks a Template's layout before it is saved, under the lock: `original` is the version stored
 * (null for a new Template). Returns why it is refused, or null.
 */
export type TemplateCheck = (template: Template, original: Template | null) => string | null

/** The stored Templates, in the order made (the built-ins are not among them). */
export async function readTemplates(dataFolder: string): Promise<TemplatesRead> {
  const read = await readSealed(templatesPath(dataFolder))
  switch (read.status) {
    case 'missing':
      return { ok: true, templates: [] }
    case 'tampered':
      return { ok: false, message: `The Templates (${TEMPLATES_FILE_NAME}) were changed outside the app.` }
    case 'unreadable':
      return { ok: false, message: `The Templates could not be used: ${read.message}` }
    case 'ok': {
      const templates = Array.isArray(read.value) ? read.value.map(parseTemplate) : null
      return templates && templates.every((template) => template !== null)
        ? { ok: true, templates: templates as Template[] }
        : { ok: false, message: `The Templates (${TEMPLATES_FILE_NAME}) are not a valid list.` }
    }
  }
}

/**
 * Saves a Template: a new one (id `''`) gets an id; any other replaces the stored one with its id.
 * Its name must be new, ignoring case; `check` judges its layout.
 */
export function saveTemplate(dataFolder: string, template: Template, check: TemplateCheck, deps: LockDeps = defaultLockDeps): Promise<TemplateChange<Template>> {
  return changeTemplates(
    dataFolder,
    (templates) => {
      const original = template.id === '' ? null : templates.find((entry) => entry.id === template.id)
      if (original === undefined) return refusal(template.id) ?? gone()
      const named = nameProblem(templates, template.name, template.id)
      if (!named.ok) return named
      const problem = check(template, original)
      if (problem) return { ok: false, message: problem }
      const saved: Template = { ...template, id: original ? original.id : crypto.randomUUID(), name: named.name, builtIn: false }
      return { ok: true, templates: original ? templates.map((entry) => (entry === original ? saved : entry)) : [...templates, saved], value: saved }
    },
    deps
  )
}

/** Renames a stored Template; the name must be new, ignoring case. */
export function renameTemplate(dataFolder: string, id: string, name: string, deps: LockDeps = defaultLockDeps): Promise<TemplateChange<Template>> {
  return changeTemplates(
    dataFolder,
    (templates) => {
      const found = templates.find((entry) => entry.id === id)
      if (!found) return refusal(id) ?? gone()
      const named = nameProblem(templates, name, id)
      if (!named.ok) return named
      const renamed = { ...found, name: named.name }
      return { ok: true, templates: templates.map((entry) => (entry === found ? renamed : entry)), value: renamed }
    },
    deps
  )
}

/** Copies a built-in or stored Template, as it is, under a new name. */
export function copyTemplate(dataFolder: string, id: string, name: string, deps: LockDeps = defaultLockDeps): Promise<TemplateChange<Template>> {
  return changeTemplates(
    dataFolder,
    (templates) => {
      const found = [...BUILT_IN_TEMPLATES, ...templates].find((entry) => entry.id === id)
      if (!found) return gone()
      const named = nameProblem(templates, name, null)
      if (!named.ok) return named
      const copy: Template = { ...found, id: crypto.randomUUID(), name: named.name, builtIn: false }
      return { ok: true, templates: [...templates, copy], value: copy }
    },
    deps
  )
}

/** Deletes a stored Template; returns it. */
export function deleteTemplate(dataFolder: string, id: string, deps: LockDeps = defaultLockDeps): Promise<TemplateChange<Template>> {
  return changeTemplates(
    dataFolder,
    (templates) => {
      const found = templates.find((entry) => entry.id === id)
      if (!found) return refusal(id) ?? gone()
      return { ok: true, templates: templates.filter((entry) => entry !== found), value: found }
    },
    deps
  )
}

/** Why a built-in Template cannot be changed; null for any other id. */
function refusal(id: string): { ok: false; message: string } | null {
  const builtIn = BUILT_IN_TEMPLATES.find((template) => template.id === id)
  return builtIn ? { ok: false, message: `${builtIn.name} is built in and cannot be changed. Copy it to make your own.` } : null
}

function gone(): { ok: false; message: string } {
  return { ok: false, message: 'That template is no longer there; another PC may have deleted it.' }
}

/** The name trimmed, unless it is not valid or another Template (`selfId` aside) has it, ignoring case. */
function nameProblem(templates: readonly Template[], name: unknown, selfId: string | null): { ok: true; name: string } | { ok: false; message: string } {
  const named = normaliseTemplateName(name)
  if (!named.ok) return named
  const taken = [...BUILT_IN_TEMPLATES, ...templates].find((entry) => entry.id !== selfId && entry.name.toLowerCase() === named.name.toLowerCase())
  return taken ? { ok: false, message: `There is already a template named "${taken.name}".` } : named
}

/** Applies `change` to the stored Templates under the lock and writes the result. */
async function changeTemplates<T>(
  dataFolder: string,
  change: (templates: readonly Template[]) => { ok: true; templates: readonly Template[]; value: T } | { ok: false; message: string },
  deps: LockDeps
): Promise<TemplateChange<T>> {
  return withFileLock(templatesLockPath(dataFolder), 'The Templates', deps, async () => {
    const current = await readTemplates(dataFolder)
    if (!current.ok) return current
    const changed = change(current.templates)
    if (!changed.ok) return changed
    try {
      await writeSealed(templatesPath(dataFolder), changed.templates)
    } catch (error) {
      return { ok: false, message: `The Templates could not be saved: ${errorText(error)}` }
    }
    return { ok: true, value: changed.value }
  })
}
