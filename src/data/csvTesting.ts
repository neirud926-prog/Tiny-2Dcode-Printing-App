import { expect } from 'vitest'

/** Test helper: splits a CSV line written by a log (fields quoted only when needed). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const character = line[i]
    if (quoted) {
      if (character === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') {
      fields.push(field)
      field = ''
    } else field += character
  }
  fields.push(field)
  return fields
}

/** Test helper: the lines of a log file, which must end with CRLF. */
export function linesOf(content: string): string[] {
  expect(content.endsWith('\r\n')).toBe(true)
  return content.slice(0, -2).split('\r\n')
}
