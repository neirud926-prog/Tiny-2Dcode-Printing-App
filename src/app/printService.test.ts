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
import type { DriverPaper } from './host'
import { printLabelRequest, printTestLabel, printerProblem, showsPrinterGuide, type DriverResult, type PrintServiceDeps } from './printService'

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

/** A Tape Size: 24 mm tape, 40 mm long. */
const tapeSize: LabelSizeEntry = { id: 'bins', name: '24 mm tape × 40 mm', kind: 'tape', widthMm: 40, heightMm: 24 }
const tapeSettings: PcSettings = { printerName: 'Brother PT-P900W', printerResolution: 360, labelSizeId: tapeSize.id, offsets: {}, logFolder: null }

/**
 * A print service over a temp data folder, with a fake printer that records each job and reports
 * `paper` as its driver's default paper.
 */
async function setup(driver: DriverResult | Error = { ok: true }, paper: DriverPaper | null | Error = null) {
  const dataFolder = await tempFolder()
  const jobs: LabelPrintJob[] = []
  const paperReads: string[] = []
  const deps: PrintServiceDeps = {
    now: () => now,
    readDefaultPaper: async (printerName) => {
      paperReads.push(printerName)
      if (paper instanceof Error) throw paper
      return paper
    },
    sendToPrinter: async (job) => {
      jobs.push(job)
      if (driver instanceof Error) throw driver
      return driver
    },
    appendLog: appendPrintLog
  }
  const context = { dataFolder, pcName: 'PHARM-01', windowsUser: 'chantm' }
  const logFile = join(dataFolder, 'logs', 'print-log-2026-10-PHARM-01.csv')
  return { dataFolder, jobs, paperReads, deps, context, logFile }
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
      '2026-10-19 14:03:07,chantm,PHARM-01,PARA18,60,20425873440489,2027-12-31,2512172-1,3,GTIN,,,,',
      '2026-10-19 14:03:07,chantm,PHARM-01,PARA18,60,20425873440489,2027-12-31,2512172-1,1,GTIN,,,,'
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

describe('the driver tape check before a Tape Size prints', () => {
  it("prints when the driver's default paper is the tape width and length, within a tenth of a mm", async () => {
    const { jobs, paperReads, deps } = await setup({ ok: true }, { widthMm: 23.9, lengthMm: 40.1 })
    expect(await printTestLabel(tapeSettings, tapeSize, deps)).toEqual({
      ok: true,
      message: 'Test label sent to Brother PT-P900W. If it is not centred on the label, adjust the offsets.',
      warning: null
    })
    expect(paperReads).toEqual(['Brother PT-P900W'])
    expect(jobs).toHaveLength(1)
  })

  it('prints when the driver reports the width but no length', async () => {
    const { jobs, deps } = await setup({ ok: true }, { widthMm: 24, lengthMm: null })
    expect(await printTestLabel(tapeSettings, tapeSize, deps)).toMatchObject({ ok: true, warning: null })
    expect(jobs).toHaveLength(1)
  })

  it('refuses another tape width, naming both and Printing preferences, and sends nothing', async () => {
    const { jobs, deps } = await setup({ ok: true }, { widthMm: 36, lengthMm: null })
    expect(await printTestLabel(tapeSettings, tapeSize, deps)).toEqual({
      ok: false,
      message: 'Test print failed: The printer is set to 36 mm tape; set 24 mm in its Printing preferences.'
    })
    expect(jobs).toHaveLength(0)
  })

  it('prints another length with a warning, as driver papers may carry a fixed nominal length', async () => {
    const { jobs, deps } = await setup({ ok: true }, { widthMm: 24, lengthMm: 100 })
    expect(await printTestLabel(tapeSettings, tapeSize, deps)).toMatchObject({
      ok: true,
      warning: 'The printer is set to 100 mm long labels; set 40 mm in its Printing preferences so each label is 40 mm.'
    })
    expect(jobs).toHaveLength(1)
  })

  it('refuses another tape width even when the length differs too', async () => {
    const { jobs, deps } = await setup({ ok: true }, { widthMm: 36, lengthMm: 100 })
    expect(await printTestLabel(tapeSettings, tapeSize, deps)).toEqual({
      ok: false,
      message: 'Test print failed: The printer is set to 36 mm tape; set 24 mm in its Printing preferences.'
    })
    expect(jobs).toHaveLength(0)
  })

  it('prints with a warning when the driver reports nothing usable', async () => {
    for (const paper of [null, new Error('OpenPrinter failed')]) {
      const { jobs, deps } = await setup({ ok: true }, paper)
      expect(await printTestLabel(tapeSettings, tapeSize, deps)).toMatchObject({
        ok: true,
        warning: 'Could not check the tape width; check the printer is set to 24 mm tape.'
      })
      expect(jobs).toHaveLength(1)
    }
  })

  it('does not check die-cut Label Sizes', async () => {
    const { jobs, paperReads, deps } = await setup({ ok: true }, { widthMm: 36, lengthMm: null })
    expect(await printTestLabel(testSettings, testSize, deps)).toMatchObject({ ok: true, warning: null })
    expect(await printLabelRequest(request, settings, sizes, itemList, (await setup()).context, deps)).toMatchObject({ ok: true })
    expect(paperReads).toEqual([])
    expect(jobs).toHaveLength(2)
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

describe('showsPrinterGuide: the "How to set the printer" link', () => {
  it('shows with a tape width refusal, a length warning and an unchecked tape', async () => {
    for (const paper of [{ widthMm: 36, lengthMm: null }, { widthMm: 24, lengthMm: 100 }, null]) {
      const { deps } = await setup({ ok: true }, paper)
      expect(showsPrinterGuide(await printTestLabel(tapeSettings, tapeSize, deps))).toBe(true)
    }
  })

  it('shows when the tape warning comes with a print log warning', () => {
    expect(
      showsPrinterGuide({
        ok: true,
        message: 'Printed 1 label on Brother PT-P900W.',
        warning: 'Could not check the tape width; check the printer is set to 24 mm tape. The print log could not be written: disk full'
      })
    ).toBe(true)
  })

  it('does not show for a tape that matches, other refusals or no outcome', async () => {
    const { deps } = await setup({ ok: false, reason: 'Invalid printer settings' }, { widthMm: 24, lengthMm: 40 })
    expect(showsPrinterGuide(await printTestLabel(tapeSettings, tapeSize, (await setup({ ok: true }, { widthMm: 24, lengthMm: 40 })).deps))).toBe(false)
    expect(showsPrinterGuide(await printTestLabel(tapeSettings, tapeSize, deps))).toBe(false)
    expect(showsPrinterGuide({ ok: false, message: "Not printed: set up this PC's printer first." })).toBe(false)
    expect(showsPrinterGuide(null)).toBe(false)
  })
})
