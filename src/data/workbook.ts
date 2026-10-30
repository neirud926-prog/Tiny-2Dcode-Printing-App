/**
 * Reads one sheet's cells, as text, from an Excel workbook (`.xlsx` or `.xlsm`): a zip of XML parts.
 * Only what an import needs: the sheet found by name through the workbook's relationships, shared,
 * rich and inline strings, and the cached value of numbers and formulas. No Node and no DOM (Web
 * DecompressionStream and plain text scanning), so it runs in the webview and in Node alike.
 */

/** One row with at least one non-empty cell; `cells[0]` is column A, a missing cell is `''`. */
export interface SheetRow {
  /** The row number in the sheet, from 1. */
  readonly number: number
  readonly cells: readonly string[]
}

export type ReadSheetResult = { readonly ok: true; readonly rows: readonly SheetRow[] } | { readonly ok: false; readonly message: string }

/** A larger part of a workbook (unzipped) is not read: an import's sheets are a few MB. */
const MAX_PART_BYTES = 64 * 1024 * 1024

const NOT_A_WORKBOOK = 'This is not an Excel workbook (.xlsx or .xlsm).'

/** The rows of the sheet named `sheetName` (exactly, as on its tab) in the workbook `bytes`. */
export async function readWorkbookSheet(bytes: Uint8Array, sheetName: string): Promise<ReadSheetResult> {
  let zip: ZipEntries
  let workbook: string | null
  let relationships: string | null
  try {
    zip = zipEntries(bytes)
    workbook = await zip.text('xl/workbook.xml')
    relationships = await zip.text('xl/_rels/workbook.xml.rels')
  } catch {
    return { ok: false, message: NOT_A_WORKBOOK }
  }
  if (workbook === null || relationships === null) return { ok: false, message: NOT_A_WORKBOOK }

  const targets = new Map<string, { type: string; path: string }>()
  for (const [, attributes] of relationships.matchAll(/<Relationship\b([^>]*)>/g)) {
    const { Id, Type, Target } = attributesOf(attributes)
    if (Id && Target) targets.set(Id, { type: Type ?? '', path: Target.startsWith('/') ? Target.slice(1) : `xl/${Target}` })
  }
  let sheetPath: string | undefined
  for (const [, attributes] of workbook.matchAll(/<sheet\b([^>]*)>/g)) {
    const sheet = attributesOf(attributes)
    const id = Object.entries(sheet).find(([key]) => key.endsWith(':id'))?.[1]
    if (sheet.name !== undefined && unescapeXml(sheet.name) === sheetName && id) sheetPath = targets.get(id)?.path
  }
  if (sheetPath === undefined) return { ok: false, message: `The workbook has no sheet named "${sheetName}".` }

  try {
    const sheet = await zip.text(sheetPath)
    if (sheet === null) return { ok: false, message: NOT_A_WORKBOOK }
    const sharedStringsPath = [...targets.values()].find((target) => target.type.endsWith('/sharedStrings'))?.path
    const sharedStrings = sharedStringsPath ? await zip.text(sharedStringsPath) : null
    return { ok: true, rows: sheetRows(sheet, sharedStrings === null ? [] : stringItems(sharedStrings)) }
  } catch {
    return { ok: false, message: NOT_A_WORKBOOK }
  }
}

/** When the workbook was last saved, ISO 8601, as recorded in it (`docProps/core.xml`); null if it is not recorded. */
export async function readWorkbookModified(bytes: Uint8Array): Promise<string | null> {
  try {
    const core = await zipEntries(bytes).text('docProps/core.xml')
    const modified = core && /<dcterms:modified\b[^>]*>([^<]*)</.exec(core)?.[1]
    const date = modified ? new Date(modified) : null
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
  } catch {
    return null
  }
}

function sheetRows(sheet: string, sharedStrings: readonly string[]): SheetRow[] {
  const rows: SheetRow[] = []
  let lastRow = 0
  for (const [, rowAttributes, content = ''] of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>(.*?)<\/row>)/gs)) {
    const number = Number(attributesOf(rowAttributes).r ?? lastRow + 1)
    lastRow = number
    const cells: string[] = []
    for (const [, cellAttributes, cellContent = ''] of content.matchAll(/<c\b([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const { r, t } = attributesOf(cellAttributes)
      const column = r ? columnIndex(r) : cells.length
      while (cells.length < column) cells.push('')
      cells[column] = cellText(t, cellContent, sharedStrings)
    }
    if (cells.some((cell) => cell !== '')) rows.push({ number, cells })
  }
  return rows
}

function cellText(type: string | undefined, content: string, sharedStrings: readonly string[]): string {
  if (type === 'inlineStr') return richText(/<is>(.*?)<\/is>/s.exec(content)?.[1] ?? '')
  const value = /<v>(.*?)<\/v>/s.exec(content)?.[1]
  if (value === undefined) return ''
  if (type === 's') return sharedStrings[Number(value)] ?? ''
  return unescapeXml(value)
}

/** The text of each `<si>` in the shared strings part. */
function stringItems(sharedStrings: string): string[] {
  return Array.from(sharedStrings.matchAll(/<si>(.*?)<\/si>|<si\/>/gs), ([, item = '']) => richText(item))
}

/** The text of a string item: its `<t>` runs joined, without phonetic guides (`<rPh>`). */
function richText(item: string): string {
  const runs = item.replace(/<rPh\b.*?<\/rPh>/gs, '').matchAll(/<t(?:\s[^>]*[^/>])?>(.*?)<\/t>/gs)
  return Array.from(runs, ([, text]) => unescapeXml(text)).join('')
}

/** `AB12` → 27 (column A is 0). */
function columnIndex(reference: string): number {
  let index = 0
  for (const letter of /^[A-Z]+/.exec(reference)?.[0] ?? '') index = index * 26 + letter.charCodeAt(0) - 64
  return index - 1
}

function attributesOf(text: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const [, name, value] of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attributes[name] = value
  return attributes
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** XML entities and character references, then Excel's `_xHHHH_` escapes (e.g. `_x000D_` for CR). */
function unescapeXml(text: string): string {
  return text
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) =>
      entity.startsWith('#x')
        ? String.fromCodePoint(parseInt(entity.slice(2), 16))
        : entity.startsWith('#')
          ? String.fromCodePoint(Number(entity.slice(1)))
          : ENTITIES[entity]
    )
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

interface ZipEntries {
  /** The entry `name` as UTF-8 text, or null if the zip has none. Throws if it cannot be unzipped. */
  text(name: string): Promise<string | null>
}

/** The entries of a zip file, from its central directory. Throws if `bytes` is not a zip. */
function zipEntries(bytes: Uint8Array): ZipEntries {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('No zip directory.')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map<string, { method: number; flags: number; compressedSize: number; size: number; offset: number }>()
  for (let index = 0; index < count; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('Bad zip directory.')
    const nameLength = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, {
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true)
    })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }

  return {
    async text(name) {
      const entry = entries.get(name)
      if (!entry) return null
      if (entry.flags & 1 || entry.size > MAX_PART_BYTES) throw new Error('Encrypted or too large.')
      const local = entry.offset
      if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Bad zip entry.')
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const stored = bytes.subarray(start, start + entry.compressedSize)
      if (stored.length !== entry.compressedSize) throw new Error('Truncated zip entry.')
      let data: Uint8Array
      if (entry.method === 0) data = stored
      else if (entry.method === 8) data = await inflateRaw(stored)
      else throw new Error('Unsupported zip compression.')
      if (data.length !== entry.size) throw new Error('Damaged zip entry.')
      return new TextDecoder('utf-8', { fatal: true }).decode(data)
    }
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
