import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { linesOf, parseCsvLine } from './csvTesting'
import { appendImportLog, IMPORT_LOG_HEADER, importLogFileName, importLogLine, type ImportLogEntry } from './importLog'
import { tempFolder } from './testFolder'

/** 19 Oct 2026 09:15:00 local time. */
const at = new Date(2026, 9, 19, 9, 15, 0)

const entry: ImportLogEntry = {
  at,
  windowsUser: 'chantm',
  pcName: 'PHARM-01',
  kind: 'Item List',
  file: 'S:\\Pharmacy\\HA export\\item_phq.txt',
  rowsImported: 14312,
  badRows: 0,
  result: 'Imported'
}

describe('import log line', () => {
  it('records date/time, Windows user, PC, kind, file, rows imported, bad rows and result', () => {
    expect(IMPORT_LOG_HEADER).toEqual(['Date Time', 'Windows User', 'PC', 'Kind', 'File', 'Rows imported', 'Bad rows', 'Result'])
    expect(importLogLine(entry)).toBe('2026-10-19 09:15:00,chantm,PHARM-01,Item List,S:\\Pharmacy\\HA export\\item_phq.txt,14312,0,Imported\r\n')
  })

  it('keeps a refusal reason with commas intact', () => {
    const refused = { ...entry, rowsImported: 0, badRows: 3, result: 'Refused: 3 of 120 rows are not valid Item List rows (more than 1%).' }
    expect(parseCsvLine(importLogLine(refused).trimEnd())).toEqual([
      '2026-10-19 09:15:00',
      'chantm',
      'PHARM-01',
      'Item List',
      'S:\\Pharmacy\\HA export\\item_phq.txt',
      '0',
      '3',
      'Refused: 3 of 120 rows are not valid Item List rows (more than 1%).'
    ])
  })

  it('names the file by month and PC', () => {
    expect(importLogFileName('PHARM-01', at)).toBe('import-log-2026-10-PHARM-01.csv')
  })
})

describe('appendImportLog', () => {
  it('starts the month file with a header row, then appends one line per import', async () => {
    const logFolder = join(await tempFolder(), 'logs')
    const path = await appendImportLog(logFolder, entry)
    expect(path).toBe(join(logFolder, 'import-log-2026-10-PHARM-01.csv'))
    const refused = { ...entry, rowsImported: 0, badRows: 40, result: 'Refused: wrong file' }
    await appendImportLog(logFolder, refused)
    expect(linesOf(await readFile(path, 'utf8'))).toEqual([IMPORT_LOG_HEADER.join(','), importLogLine(entry).trimEnd(), importLogLine(refused).trimEnd()])
    expect(await readdir(logFolder)).toEqual(['import-log-2026-10-PHARM-01.csv'])
  })
})
