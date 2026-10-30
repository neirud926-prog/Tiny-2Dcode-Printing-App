import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWorkbookModified, readWorkbookSheet } from './workbook'

/** A made-up workbook shaped as Excel writes one: shared strings, sheets found through their relationships. */
const fixture = join(__dirname, '../../test-fixtures/topup-synthetic.xlsx')

describe('readWorkbookSheet', () => {
  it("reads a sheet's cells by name as text: shared, rich and inline strings, numbers and formula results", async () => {
    const read = await readWorkbookSheet(await readFile(fixture), 'DataBase')
    expect(read).toEqual({
      ok: true,
      rows: [
        { number: 1, cells: ['Form Code', 'Item Code', 'Item Description', 'Salt / Special Property (MOE)', 'Display Name (MOE)'] },
        { number: 2, cells: ['TAB', 'FICT01', 'FICTAMOL 500MG TABLET', '', 'FICTAMOL'] },
        { number: 3, cells: ['SYR', 'FICT02', 'FICTAMOL (SODIUM) SYRUP 120MG/5ML', 'SODIUM', 'FICTAMOL'] },
        { number: 4, cells: ['CYN', 'GAS 01', 'SYNTH GAS (DISSOLVED & INDUSTRIAL) CYLINDER', '', 'SYNTH GAS (DISSOLVED & INDUSTRIAL)'] },
        { number: 5, cells: ['INJ', 'FICT01', 'FICTAMOL REPEATED ROW', '', 'NOT THIS ONE'] },
        { number: 6, cells: ['CAP', 'RICH01', 'RICH TEXT CODE', 'HCL', '  SPACED  NAME '] },
        { number: 7, cells: ['INJ', '123456', '', '', 'NUMERIC'] },
        { number: 8, cells: ['CRM', 'CREM01', '', '', 'CRÈME SYNTHÉTIQUE'] }
      ]
    })
  })

  it('reads another sheet by name', async () => {
    expect(await readWorkbookSheet(await readFile(fixture), 'QR Code')).toEqual({ ok: true, rows: [{ number: 1, cells: ['Item Code'] }] })
  })

  it('says when the sheet is not there', async () => {
    expect(await readWorkbookSheet(await readFile(fixture), 'Database ')).toEqual({ ok: false, message: 'The workbook has no sheet named "Database ".' })
  })

  it('says when the file is not a workbook', async () => {
    const message = 'This is not an Excel workbook (.xlsx or .xlsm).'
    expect(await readWorkbookSheet(new TextEncoder().encode('Item Code\tDisplay Name\r\n'), 'DataBase')).toEqual({ ok: false, message })
    const workbook = await readFile(fixture)
    expect(await readWorkbookSheet(workbook.subarray(0, workbook.length - 30), 'DataBase')).toEqual({ ok: false, message })
  })
})

describe('readWorkbookModified', () => {
  it('is when the workbook was last saved, as Excel records it inside the file', async () => {
    expect(await readWorkbookModified(await readFile(fixture))).toBe('2026-09-30T08:14:44.000Z')
  })

  it('is null for a file that is not a workbook', async () => {
    expect(await readWorkbookModified(new Uint8Array(10))).toBeNull()
  })
})
