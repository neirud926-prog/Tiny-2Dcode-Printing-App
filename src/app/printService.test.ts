import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexItems } from '../core/itemList'
import type { LabelRequest } from '../core/label'
import { appendPrintLog, PRINT_LOG_HEADER } from '../data/printLog'
import { tempFolder } from '../data/testFolder'
import { DOT_MM } from '../render/dataMatrix'
import type { LabelPrintJob } from '../render/printJob'
import { SMALL_LABEL, type LabelSizeEntry, type PcSettings } from '../render/printSettings'
import { printLabelRequest, printTestLabel, printerProblem, type DriverResult, type PrintServiceDeps } from './printService'

const request: LabelRequest = { itemCode: 'para18', packVolumeDigit: 2, expiry: '31122027', lot: '2512172-1', copies: 3 }

const settings: PcSettings = {
  printerName: 'ZDesigner GX420t', printerResolution: 203,
  labelSizeId: SMALL_LABEL.id,
  offsets: { [SMALL_LABEL.id]: { offsetXmm: 2 * DOT_MM, offsetYmm: 0 }, other: { offsetXmm: 0, offsetYmm: 0 } },
  logFolder: null
}

/** The Label Size list: the Small Label and another die-cut size. */
const sizes: readonly LabelSizeEntry[] = [SMALL_LABEL, { id: 'other', name: 'Other', kind: 'label', widthMm: 50, heightMm: 30 }]

/** What Test print is given: the loaded size and its offsets. */
const testSize: LabelSizeEntry = { id: 'small-roll', name: 'Small roll', kind: 'label', widthMm: 30, heightMm: 20 }
const testSettings: PcSettings = {
  printerName: 'ZDesigner GX420t',
  printerResolution: 203,
  labelSizeId: testSize.id,
  offsets: { [testSize.id]: { offsetXmm: 2 * DOT_MM, offsetYmm: 0 } },
  logFolder: null
}

const itemList = indexItems([
  { itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' },
  { itemCode: 'PARA18', name: 'SYNTHETIC FICTAMOL ORAL SOLUTION', baseUnit: 'ML' }
])

/** 19 Oct 2026 14:03:07 local time. */
const now = new Date(2026, 9, 19, 14, 3, 7)

/** A print service over a temp data folder, with a fake printer that records each job. */
async function setup(driver: DriverResult | Error = { ok: true }) {
  const dataFolder = await tempFolder()
  const jobs: LabelPrintJob[] = []
  const deps: PrintServiceDeps = {
    now: () => now,
    sendToPrinter: async (job) => {
      jobs.push(job)
      if (driver instanceof Error) throw driver
      return driver
    },
    appendLog: appendPrintLog
  }
  const context = { dataFolder, pcName: 'PHARM-01', windowsUser: 'chantm' }
  const logFile = join(dataFolder, 'logs', 'print-log-2026-10-PHARM-01.csv')
  return { dataFolder, jobs, deps, context, logFile }
}

describe('printLabelRequest', () => {
  it('prints on the configured printer, on the Small Label with its offsets, and copies', async () => {
    const { jobs, deps, context } = await setup()
    const outcome = await printLabelRequest(request, settings, sizes, itemList, context, deps)
    expect(outcome).toEqual({ ok: true, message: 'Printed 3 labels on ZDesigner GX420t.', warning: null })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({
      silent: true,
      deviceName: 'ZDesigner GX420t',
      pageSize: { width: 34_400, height: 25_000 },
      copies: 3,
      margins: { marginType: 'none' }
    })
    expect(jobs[0].html).toContain('@page{size:34.4mm 25mm;margin:0}')
  })

  it('refuses a GTIN Label on another die-cut size', async () => {
    const { jobs, deps, context, logFile } = await setup()
    const outcome = await printLabelRequest(request, { ...settings, labelSizeId: 'other' }, sizes, itemList, context, deps)
    expect(outcome).toEqual({ ok: false, message: 'Not printed: GTIN Labels print on the Small Label (34.4 × 25 mm) or on 18, 24 or 36 mm tape. Change the label in Settings.' })
    expect(jobs).toHaveLength(0)
    await expect(readFile(logFile)).rejects.toThrow(/ENOENT/)
  })

  it('adds exactly one print log line per print, with the label fields', async () => {
    const { deps, context, logFile } = await setup()
    await printLabelRequest(request, settings, sizes, itemList, context, deps)
    await printLabelRequest({ ...request, copies: 1 }, settings, sizes, itemList, context, deps)
    const lines = (await readFile(logFile, 'utf8')).trimEnd().split('\r\n')
    expect(lines).toEqual([
      PRINT_LOG_HEADER.join(','),
      '2026-10-19 14:03:07,chantm,PHARM-01,PARA18,60,20425873440489,2027-12-31,2512172-1,3,GTIN,,,',
      '2026-10-19 14:03:07,chantm,PHARM-01,PARA18,60,20425873440489,2027-12-31,2512172-1,1,GTIN,,,'
    ])
  })

  it('says "1 label" for one copy', async () => {
    const { deps, context } = await setup()
    expect(await printLabelRequest({ ...request, copies: 1 }, settings, sizes, itemList, context, deps)).toMatchObject({ message: 'Printed 1 label on ZDesigner GX420t.' })
  })

  it('writes the log to the chosen log folder', async () => {
    const { deps, context } = await setup()
    const logFolder = await tempFolder()
    await printLabelRequest(request, { ...settings, logFolder }, sizes, itemList, context, deps)
    expect(await readdir(logFolder)).toEqual(['print-log-2026-10-PHARM-01.csv'])
  })

  it('rebuilds and checks the label itself, refusing what the label core refuses', async () => {
    const { jobs, deps, context, logFile } = await setup()
    // Expired by the main process's own clock, whatever the renderer thought.
    const outcome = await printLabelRequest({ ...request, expiry: '18102026' }, settings, sizes, itemList, context, deps)
    expect(outcome).toEqual({ ok: false, message: 'Not printed: This Expiry (18 OCT 2026) has already passed.' })
    expect(jobs).toEqual([])
    await expect(readFile(logFile)).rejects.toThrow(/ENOENT/)
  })

  it('refuses an Item Code that is not in the Item List, whatever the renderer allowed', async () => {
    const { jobs, deps, context, logFile } = await setup()
    const outcome = await printLabelRequest({ ...request, itemCode: 'para99', packVolumeDigit: 0 }, settings, sizes, itemList, context, deps)
    expect(outcome).toEqual({ ok: false, message: 'Not printed: PARA99 is not in the Item List.' })
    expect(jobs).toEqual([])
    await expect(readFile(logFile)).rejects.toThrow(/ENOENT/)
  })

  it('refuses a Pack Volume for an item that is not a liquid', async () => {
    const { jobs, deps, context } = await setup()
    const outcome = await printLabelRequest({ ...request, itemCode: 'PARA01', packVolumeDigit: 2 }, settings, sizes, itemList, context, deps)
    expect(outcome).toEqual({ ok: false, message: 'Not printed: PARA01 is not a liquid (base unit TAB), so it has no Pack Volume.' })
    expect(jobs).toEqual([])
  })

  it('prints a non-liquid with Pack Volume digit 0, and a liquid with any of 0–5', async () => {
    const { deps, context, logFile } = await setup()
    const requests = [
      { ...request, itemCode: 'PARA01', packVolumeDigit: 0 },
      ...[0, 1, 2, 3, 4, 5].map((packVolumeDigit) => ({ ...request, packVolumeDigit }))
    ]
    for (const each of requests) expect(await printLabelRequest(each, settings, sizes, itemList, context, deps)).toMatchObject({ ok: true })
    const logged = (await readFile(logFile, 'utf8')).trimEnd().split('\r\n').slice(1).map((line) => line.split(','))
    expect(logged.map((fields) => [fields[3], fields[4], fields[5][0]])).toEqual([
      ['PARA01', '', '0'],
      ['PARA18', '', '0'],
      ['PARA18', '30', '1'],
      ['PARA18', '60', '2'],
      ['PARA18', '120', '3'],
      ['PARA18', '240', '4'],
      ['PARA18', '480', '5']
    ])
  })

  it('refuses to print before the Item List is imported', async () => {
    const { jobs, deps, context } = await setup()
    expect(await printLabelRequest(request, settings, sizes, null, context, deps)).toEqual({ ok: false, message: 'Not printed: import the Item List first.' })
    expect(jobs).toEqual([])
  })

  it('refuses a request that is not a label request', async () => {
    const { jobs, deps, context } = await setup()
    for (const bad of [null, 'PARA01', { ...request, copies: '3' }, { ...request, lot: undefined }]) {
      expect(await printLabelRequest(bad, settings, sizes, itemList, context, deps)).toEqual({ ok: false, message: 'Not printed: the label request is not valid.' })
    }
    expect(jobs).toEqual([])
  })

  it('refuses to print before this PC is set up', async () => {
    const { jobs, deps, context } = await setup()
    expect(await printLabelRequest(request, null, sizes, itemList, context, deps)).toEqual({ ok: false, message: "Not printed: set up this PC's printer first." })
    expect(jobs).toEqual([])
  })

  it("reports the driver's reason and logs nothing when the print fails", async () => {
    const { deps, context, logFile } = await setup({ ok: false, reason: 'Print job failed' })
    expect(await printLabelRequest(request, settings, sizes, itemList, context, deps)).toEqual({ ok: false, message: 'Not printed: the printer reported "Print job failed".' })
    await expect(readFile(logFile)).rejects.toThrow(/ENOENT/)
  })

  it('reports a print that throws, with no reason given', async () => {
    const empty = await setup({ ok: false, reason: '' })
    expect(await printLabelRequest(request, settings, sizes, itemList, empty.context, empty.deps)).toEqual({ ok: false, message: 'Not printed: the printer reported a failure.' })
    const thrown = await setup(new Error('Invalid deviceName provided'))
    expect(await printLabelRequest(request, settings, sizes, itemList, thrown.context, thrown.deps)).toEqual({
      ok: false,
      message: 'Not printed: Invalid deviceName provided'
    })
  })

  it('still reports the print when the log cannot be written', async () => {
    const { deps, context } = await setup()
    const outcome = await printLabelRequest(request, settings, sizes, itemList, context, {
      ...deps,
      appendLog: async () => {
        throw new Error('EACCES: permission denied')
      }
    })
    expect(outcome).toEqual({
      ok: true,
      message: 'Printed 3 labels on ZDesigner GX420t.',
      warning: 'The print log could not be written: EACCES: permission denied'
    })
  })
})

describe('printTestLabel', () => {
  it('prints one TEST01 sample label with the given settings and logs nothing', async () => {
    const { jobs, deps, logFile } = await setup()
    const outcome = await printTestLabel(testSettings, testSize, deps)
    expect(outcome).toEqual({
      ok: true,
      message: 'Test label sent to ZDesigner GX420t. If it is not centred on the label, adjust the offsets.',
      warning: null
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({ deviceName: 'ZDesigner GX420t', pageSize: { width: 30_000, height: 20_000 }, copies: 1 })
    expect(jobs[0].html).toContain('TEST01')
    expect(jobs[0].html).toContain('01 OCT 2027')
    await expect(readFile(logFile)).rejects.toThrow(/ENOENT/)
  })

  it("reports the driver's reason", async () => {
    const { deps } = await setup({ ok: false, reason: 'Invalid printer settings' })
    expect(await printTestLabel(testSettings, testSize, deps)).toEqual({ ok: false, message: 'Test print failed: the printer reported "Invalid printer settings".' })
  })
})

describe('printerProblem', () => {
  const installed = [
    { name: 'ZDesigner GX420t', displayName: 'ZDesigner GX420t' },
    { name: 'Office_Laser', displayName: 'Office Laser' }
  ]

  it('accepts an installed printer', () => {
    expect(printerProblem('Office_Laser', installed)).toBeNull()
  })

  it('names a printer that is not installed', () => {
    expect(printerProblem('Zebra', installed)).toBe('The printer "Zebra" is not installed on this PC. Choose another printer.')
  })
})
