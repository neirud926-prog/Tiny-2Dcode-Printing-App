import { describe, expect, it } from 'vitest'
import type { LabelRequest } from '../core/label'
import { tempFolder } from '../data/testFolder'
import { DOT_MM } from '../render/dataMatrix'
import type { LabelPrintJob } from '../render/printJob'
import { SMALL_LABEL, type PcSettings } from '../render/printSettings'
import type { PreloadApi } from '../preload/api'
import { createAppService } from './service'

const printer = 'ZDesigner GX420t'
const request: LabelRequest = { itemCode: 'PARA01', packVolumeDigit: 0, expiry: '31122099', lot: 'A1', copies: 1 }

/** The app on one PC over a shared data folder, with a fake printer that records each job. */
async function pc(dataFolder: string, pcName: string): Promise<{ api: PreloadApi; jobs: LabelPrintJob[] }> {
  const jobs: LabelPrintJob[] = []
  const api = createAppService({
    dataFolder,
    pcName,
    windowsUser: 'chantm',
    chooseFile: async () => null,
    listPrinters: async () => [{ name: printer, displayName: printer }],
    sendToPrinter: async (job) => {
      jobs.push(job)
      return { ok: true }
    }
  })
  expect((await api.getStartup()).status).toBe('ready')
  return { api, jobs }
}

function settingsFor(labelSizeId: string, offsets: PcSettings['offsets'] = {}): PcSettings {
  return { printerName: printer, labelSizeId, offsets, logFolder: null }
}

async function addSize(api: PreloadApi, name: string, widthMm: number, heightMm: number): Promise<string> {
  const added = await api.addLabelSize({ name, widthMm, heightMm })
  if (!added.ok) throw new Error(added.message)
  return added.sizes.find((size) => size.name === name)!.id
}

describe('Label Sizes in the app', () => {
  it('are shared by every PC, with no update lost when two PCs add at once', async () => {
    const folder = await tempFolder()
    const [one, two] = await Promise.all([pc(folder, 'PHARM-01'), pc(folder, 'PHARM-02')])
    const added = await Promise.all([one.api.addLabelSize({ name: 'Shelf', widthMm: 50, heightMm: 30 }), two.api.addLabelSize({ name: 'Bag', widthMm: 60, heightMm: 40 })])
    expect(added.every((outcome) => outcome.ok)).toBe(true)
    for (const each of [one, two]) {
      const listed = await each.api.listLabelSizes()
      expect(listed.ok && listed.sizes.map((size) => size.name).sort()).toEqual(['Bag', 'Shelf', 'Small Label'])
    }
    expect(await two.api.addLabelSize({ name: 'shelf', widthMm: 70, heightMm: 40 })).toEqual({ ok: false, message: 'There is already a label size named "Shelf".' })
  })

  it('keep the Small Label first and unchangeable', async () => {
    const { api } = await pc(await tempFolder(), 'PHARM-01')
    expect(await api.deleteLabelSize(SMALL_LABEL.id)).toEqual({ ok: false, message: 'The Small Label is built in and cannot be deleted.' })
    expect(await api.addLabelSize({ name: 'Small Label', widthMm: 34.4, heightMm: 25 })).toMatchObject({ ok: false })
    expect(await api.listLabelSizes()).toEqual({ ok: true, sizes: [SMALL_LABEL] })
  })

  it('refuse to delete the size loaded in this PC, but another PC may', async () => {
    const folder = await tempFolder()
    const one = await pc(folder, 'PHARM-01')
    const two = await pc(folder, 'PHARM-02')
    const shelf = await addSize(one.api, 'Shelf', 50, 30)
    expect((await one.api.savePrinterSettings(settingsFor(shelf))).ok).toBe(true)
    expect(await one.api.deleteLabelSize(shelf)).toEqual({ ok: false, message: 'The label size "Shelf" is loaded in this printer. Change the label in Settings first.' })
    expect(await two.api.deleteLabelSize(shelf)).toEqual({ ok: true, sizes: [SMALL_LABEL] })
  })
})

describe('the loaded Label Size', () => {
  it('keeps offsets per size, restored when the size is loaded again', async () => {
    const folder = await tempFolder()
    const { api, jobs } = await pc(folder, 'PHARM-01')
    const shelf = await addSize(api, 'Shelf', 50, 30)
    const offsets = { [SMALL_LABEL.id]: { offsetXmm: 2 * DOT_MM, offsetYmm: 0 }, [shelf]: { offsetXmm: -4 * DOT_MM, offsetYmm: 3 * DOT_MM } }
    expect((await api.savePrinterSettings(settingsFor(shelf, offsets))).ok).toBe(true)

    const later = await pc(folder, 'PHARM-01')
    const startup = await later.api.getStartup()
    expect(startup.status === 'ready' && startup.settings).toEqual(settingsFor(shelf, offsets))
    expect((await later.api.savePrinterSettings(settingsFor(SMALL_LABEL.id, offsets))).ok).toBe(true)
    expect(await later.api.testPrint(settingsFor(SMALL_LABEL.id, offsets))).toMatchObject({ ok: true })
    expect(later.jobs[0].html).toContain('@page{size:34.4mm 25mm;margin:0}')
    expect(later.jobs[0].html).toContain(`translate(${(2 * DOT_MM).toFixed(4)}mm,0.0000mm)`)
    expect(jobs).toHaveLength(0)
  })

  it('is what Test print prints on, with its offsets', async () => {
    const { api, jobs } = await pc(await tempFolder(), 'PHARM-01')
    const shelf = await addSize(api, 'Shelf', 50, 30)
    const outcome = await api.testPrint(settingsFor(shelf, { [shelf]: { offsetXmm: -4 * DOT_MM, offsetYmm: 0 } }))
    expect(outcome).toMatchObject({ ok: true })
    expect(jobs[0].options).toMatchObject({ pageSize: { width: 50_000, height: 30_000 } })
    expect(jobs[0].html).toContain(`translate(${(-4 * DOT_MM).toFixed(4)}mm,0.0000mm)`)
  })

  it('must be in the list to be saved or test printed', async () => {
    const { api, jobs } = await pc(await tempFolder(), 'PHARM-01')
    const gone = settingsFor('no-such-size')
    expect(await api.savePrinterSettings(gone)).toEqual({ ok: false, message: 'That label size is no longer in the list. Choose the label in this printer.' })
    expect(await api.testPrint(gone)).toEqual({ ok: false, message: 'Test print failed: That label size is no longer in the list. Choose the label in this printer.' })
    expect(jobs).toHaveLength(0)
  })

  it('must be the Small Label for a GTIN Label', async () => {
    const { api, jobs } = await pc(await tempFolder(), 'PHARM-01')
    const shelf = await addSize(api, 'Shelf', 50, 30)
    expect((await api.savePrinterSettings(settingsFor(shelf))).ok).toBe(true)
    expect(await api.printLabel(request)).toEqual({
      ok: false,
      message: 'Not printed: GTIN Labels print on the Small Label (34.4 × 25 mm). Change the label in Settings.'
    })
    expect(jobs).toHaveLength(0)
  })
})
