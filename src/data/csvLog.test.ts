import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendLogLine, csvField, csvLine, localDateTime, monthlyLogFileName } from './csvLog'
import { linesOf } from './csvTesting'
import { tempFolder } from './testFolder'

describe('CSV fields and lines', () => {
  it('quotes a field only when CSV needs it', () => {
    expect(csvField('PARA01')).toBe('PARA01')
    expect(csvField('AIR 01')).toBe('AIR 01')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField(' leading')).toBe('" leading"')
  })

  it('joins fields into one CRLF-terminated line', () => {
    expect(csvLine(['a', 'b,c', ''])).toBe('a,"b,c",\r\n')
  })

  it('writes local date and time as YYYY-MM-DD HH:mm:ss', () => {
    expect(localDateTime(new Date(2026, 9, 19, 14, 3, 7))).toBe('2026-10-19 14:03:07')
    expect(localDateTime(new Date(2027, 0, 1, 0, 0, 1))).toBe('2027-01-01 00:00:01')
  })

  it('names a log file by kind, local month and PC', () => {
    expect(monthlyLogFileName('import-log', 'PHARM-01', new Date(2026, 9, 31, 23, 59))).toBe('import-log-2026-10-PHARM-01.csv')
    expect(monthlyLogFileName('print-log', 'PHARM-02', new Date(2027, 0, 1, 0, 0))).toBe('print-log-2027-01-PHARM-02.csv')
  })
})

describe('appendLogLine', () => {
  it('creates the folder, writes the header with the first line, then appends', async () => {
    const logFolder = join(await tempFolder(), 'nested', 'logs')
    const header = ['When', 'What']
    const path = await appendLogLine(logFolder, 'x-log.csv', header, csvLine(['1', 'first']))
    expect(path).toBe(join(logFolder, 'x-log.csv'))
    await Promise.all([appendLogLine(logFolder, 'x-log.csv', header, csvLine(['2', 'b'])), appendLogLine(logFolder, 'x-log.csv', header, csvLine(['3', 'c']))])
    expect(linesOf(await readFile(path, 'utf8'))).toEqual(['When,What', '1,first', '2,b', '3,c'])
  })
})
