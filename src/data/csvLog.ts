/**
 * Append-only CSV logs, one file per PC per month (`<kind>-YYYY-MM-<PC>.csv`). Each PC writes only
 * its own files, so PCs sharing a log folder never write to the same file; each line is a single
 * append, so lines never interleave; a new file gets its header row in the same write as its first line.
 */
import { errorCode } from './atomicWrite'
import { platform } from './platform'

/**
 * A CSV field, quoted only when it holds a comma, quote, line break or leading/trailing space. A
 * value starting with = + - or @ gets a leading ' so Excel shows it as text, not a formula.
 */
export function csvField(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One CSV line, CRLF-terminated. */
export function csvLine(fields: readonly string[]): string {
  return fields.map(csvField).join(',') + '\r\n'
}

/** Local date and time, `YYYY-MM-DD HH:mm:ss`. */
export function localDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

/** `<kind>-YYYY-MM-<PC>.csv`, by the local month of `at`. */
export function monthlyLogFileName(kind: string, pcName: string, at: Date): string {
  return `${kind}-${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pcName}.csv`
}

/**
 * Appends `line` (CRLF-terminated) to `fileName` in `logFolder`, creating the folder, and the file
 * with `header` as its first row, if needed. Returns the file's path.
 */
export function appendLogLine(logFolder: string, fileName: string, header: readonly string[], line: string): Promise<string> {
  const { fs, path: paths } = platform()
  const path = paths.join(logFolder, fileName)
  return queued(path, async () => {
    await fs.mkdir(logFolder)
    try {
      // A new file gets the header row and the line in one write.
      await fs.createFile(path, utf8(csvLine(header) + line))
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      await fs.appendFile(path, utf8(line))
    }
    return path
  })
}

/**
 * Runs file tasks one at a time per path, so a header row is always first even if this PC logs
 * twice at once. (Only this PC writes its files, and the app runs once per PC.)
 */
const queues = new Map<string, Promise<unknown>>()

function queued<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve()
  const result = previous.then(task, task)
  const settled = result.catch(() => undefined)
  queues.set(path, settled)
  void settled.then(() => {
    if (queues.get(path) === settled) queues.delete(path)
  })
  return result
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
