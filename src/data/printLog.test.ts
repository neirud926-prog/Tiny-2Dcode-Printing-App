import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLabel, type LabelRequest } from '../core/label'
import { linesOf, parseCsvLine } from './csvTesting'
import { LAYOUT_2 } from '../core/template'
import { buildCustomLabel } from '../render/customLabel'
import { SMALL_LABEL } from '../render/printSettings'
import { appendPrintLog, customPrintLogEntryFor, PRINT_LOG_HEADER, printLogEntryFor, printLogFileName, printLogLine, type PrintLogEntry } from './printLog'
import { tempFolder } from './testFolder'

const today = '2026-10-19'

function labelFor(overrides: Partial<LabelRequest> = {}) {
  const result = buildLabel({ itemCode: 'PARA18', packVolumeDigit: 2, expiry: '31122027', lot: '2512172-1', copies: 3, ...overrides }, { today })
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.label
}

/** 19 Oct 2026 14:03:07 local time. */
const at = new Date(2026, 9, 19, 14, 3, 7)

const entry: PrintLogEntry = printLogEntryFor(labelFor(), { at, windowsUser: 'chantm', pcName: 'PHARM-01' })

describe('print log line', () => {
  it('records date/time, Windows user, PC, Item Code, Pack Volume, Internal GTIN, Expiry, Lot, copies, then Kind GTIN', () => {
    expect(PRINT_LOG_HEADER).toEqual([
      'Date Time',
      'Windows User',
      'PC',
      'Item Code',
      'Pack Volume (mL)',
      'Internal GTIN',
      'Expiry',
      'Lot',
      'Copies',
      'Kind',
      'Template',
      'Code data',
      'Text',
      'Code type'
    ])
    expect(entry).toEqual({
      at,
      windowsUser: 'chantm',
      pcName: 'PHARM-01',
      itemCode: 'PARA18',
      packVolumeMl: 60,
      internalGtin: '20425873440489',
      expiry: '2027-12-31',
      lot: '2512172-1',
      copies: 3,
      kind: 'GTIN',
      template: '',
      codeData: '',
      text: '',
      codeType: ''
    })
    expect(printLogLine(entry)).toBe('2026-10-19 14:03:07,chantm,PHARM-01,PARA18,60,20425873440489,2027-12-31,2512172-1,3,GTIN,,,,\r\n')
  })

  it('records a Custom Label with Kind Custom, its Template, code data, text lines joined by " | " and code type, and no GTIN fields', () => {
    const custom = buildCustomLabel(LAYOUT_2, SMALL_LABEL, { symbology: 'qr', codeValue: 'Bin #4 (top)', texts: ['Bin 4', '', 'a+b', 'end'], copies: 2 }, 203)
    if (!custom.ok) throw new Error(JSON.stringify(custom.errors))
    const line = printLogLine(customPrintLogEntryFor(custom.label, { at, windowsUser: 'chantm', pcName: 'PHARM-01' }))
    expect(line).toBe('2026-10-19 14:03:07,chantm,PHARM-01,,,,,,2,Custom,Layout 2,Bin #4 (top),Bin 4 |  | a+b | end,QR\r\n')
  })

  it('leaves Pack Volume blank when none is encoded', () => {
    const line = printLogLine(printLogEntryFor(labelFor({ itemCode: 'PARA01', packVolumeDigit: 0 }), { at, windowsUser: 'chantm', pcName: 'PHARM-01' }))
    expect(parseCsvLine(line.trimEnd())[4]).toBe('')
  })

  it('keeps Item Codes with spaces or &, and Lots with / ( ), intact', () => {
    const label = labelFor({ itemCode: 'A&B 01', packVolumeDigit: 0, lot: '(B)A5/29-1' })
    const fields = parseCsvLine(printLogLine(printLogEntryFor(label, { at, windowsUser: 'o"brien, k', pcName: 'PHARM-01' })).trimEnd())
    expect(fields).toEqual(['2026-10-19 14:03:07', 'o"brien, k', 'PHARM-01', 'A&B 01', '', label.internalGtin, '2027-12-31', '(B)A5/29-1', '3', 'GTIN', '', '', '', ''])
  })

  it('names the file by month and PC', () => {
    expect(printLogFileName('PHARM-01', at)).toBe('print-log-2026-10-PHARM-01.csv')
    expect(printLogFileName('PHARM-01', new Date(2027, 0, 1, 0, 0, 1))).toBe('print-log-2027-01-PHARM-01.csv')
  })
})

describe('appendPrintLog', () => {
  it('starts a new month file with a header row, then appends one line per print', async () => {
    const logFolder = join(await tempFolder(), 'logs')
    const path = await appendPrintLog(logFolder, entry)
    expect(path).toBe(join(logFolder, 'print-log-2026-10-PHARM-01.csv'))
    await appendPrintLog(logFolder, { ...entry, copies: 1 })
    const lines = linesOf(await readFile(path, 'utf8'))
    expect(lines).toEqual([PRINT_LOG_HEADER.join(','), printLogLine(entry).trimEnd(), printLogLine({ ...entry, copies: 1 }).trimEnd()])
  })

  it('starts a new file in a new month', async () => {
    const logFolder = await tempFolder()
    await appendPrintLog(logFolder, entry)
    await appendPrintLog(logFolder, { ...entry, at: new Date(2026, 10, 1, 8, 0, 0) })
    expect((await readdir(logFolder)).sort()).toEqual(['print-log-2026-10-PHARM-01.csv', 'print-log-2026-11-PHARM-01.csv'])
  })

  it('keeps every line intact when two PCs append at the same time, each to its own file', async () => {
    const logFolder = await tempFolder()
    const count = 60
    const entries = Array.from({ length: count }, (_, i) =>
      ['PHARM-01', 'PHARM-02'].map((pcName) => ({ ...entry, pcName, lot: `LOT-${pcName}-${i}`, copies: (i % 99) + 1 }))
    ).flat()
    await Promise.all(entries.map((e) => appendPrintLog(logFolder, e)))

    expect((await readdir(logFolder)).sort()).toEqual(['print-log-2026-10-PHARM-01.csv', 'print-log-2026-10-PHARM-02.csv'])
    for (const pcName of ['PHARM-01', 'PHARM-02']) {
      const lines = linesOf(await readFile(join(logFolder, `print-log-2026-10-${pcName}.csv`), 'utf8'))
      expect(lines[0]).toBe(PRINT_LOG_HEADER.join(','))
      const body = lines.slice(1)
      expect(body).toHaveLength(count)
      const expected = entries.filter((e) => e.pcName === pcName).map((e) => printLogLine(e).trimEnd())
      expect([...body].sort()).toEqual([...expected].sort())
    }
  })
})
