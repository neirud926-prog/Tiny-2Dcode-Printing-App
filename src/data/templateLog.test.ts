import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { linesOf, parseCsvLine } from './csvTesting'
import { appendTemplateLog, TEMPLATE_LOG_HEADER, templateLogFileName, templateLogLine, type TemplateLogEntry } from './templateLog'
import { tempFolder } from './testFolder'

/** 20 Oct 2026 14:05:09 local time. */
const at = new Date(2026, 9, 20, 14, 5, 9)

const entry: TemplateLogEntry = { at, windowsUser: 'chantm', pcName: 'PHARM-01', action: 'Save', template: 'Shelf bin', result: 'Saved' }

describe('template log line', () => {
  it('records date/time, Windows user, PC, action, template and result', () => {
    expect(TEMPLATE_LOG_HEADER).toEqual(['Date Time', 'Windows User', 'PC', 'Action', 'Template', 'Result'])
    expect(templateLogLine(entry)).toBe('2026-10-20 14:05:09,chantm,PHARM-01,Save,Shelf bin,Saved\r\n')
  })

  it('keeps a rename and a refusal with commas intact', () => {
    const renamed = { ...entry, action: 'Rename', template: 'Shelf bin → Bin, top', result: 'Refused: There is already a template named "Bin, top".' } as const
    expect(parseCsvLine(templateLogLine(renamed).trimEnd())).toEqual([
      '2026-10-20 14:05:09',
      'chantm',
      'PHARM-01',
      'Rename',
      'Shelf bin → Bin, top',
      'Refused: There is already a template named "Bin, top".'
    ])
  })

  it('names the file by month and PC, and starts it with a header row', async () => {
    expect(templateLogFileName('PHARM-01', at)).toBe('template-log-2026-10-PHARM-01.csv')
    const logFolder = join(await tempFolder(), 'logs')
    const path = await appendTemplateLog(logFolder, entry)
    const deleted = { ...entry, action: 'Delete', result: 'Deleted' } as const
    await appendTemplateLog(logFolder, deleted)
    expect(path).toBe(join(logFolder, 'template-log-2026-10-PHARM-01.csv'))
    expect(linesOf(await readFile(path, 'utf8'))).toEqual([TEMPLATE_LOG_HEADER.join(','), templateLogLine(entry).trimEnd(), templateLogLine(deleted).trimEnd()])
  })
})
