import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LabelRequest } from '../core/label'
import { LAYOUT_1, LAYOUT_2, type Template } from '../core/template'
import { linesOf, parseCsvLine } from '../data/csvTesting'
import { pcSettingsPath } from '../data/pcSettings'
import { writeSealed } from '../data/sealed'
import { templatesPath } from '../data/templateStore'
import { tempFolder } from '../data/testFolder'
import { dotMm, DOT_MM } from '../render/dataMatrix'
import type { CustomLabelRequest } from '../render/customLabel'
import type { LabelPrintJob } from '../render/printJob'
import { SMALL_LABEL, type PcSettings } from '../render/printSettings'
import type { PreloadApi } from '../preload/api'
import type { DriverPaper } from './host'
import { createAppService } from './service'

const printer = 'ZDesigner GX420t'
const request: LabelRequest = { itemCode: 'PARA01', packVolumeDigit: 0, expiry: '31122099', lot: 'A1', copies: 1 }

/** The synthetic Item List (PARA01, PARA18, …). */
const itemListFixture = join(__dirname, '../../test-fixtures/item_phq-synthetic.txt')

/**
 * The app on one PC over a shared data folder, with a fake printer that records each job; the file
 * dialog returns `chosenFile` (null: cancelled) and the driver's default paper is `paper` (24 mm tape unless given).
 */
async function pc(
  dataFolder: string,
  pcName: string,
  { chosenFile = null, paper = { widthMm: 24, lengthMm: null } }: { chosenFile?: string | null; paper?: DriverPaper | null } = {}
): Promise<{ api: PreloadApi; jobs: LabelPrintJob[] }> {
  const jobs: LabelPrintJob[] = []
  const api = createAppService({
    dataFolder,
    pcName,
    windowsUser: 'chantm',
    chooseFile: async () => chosenFile,
    listPrinters: async () => [{ name: printer, displayName: printer }],
    readDefaultPaper: async () => paper,
    sendToPrinter: async (job) => {
      jobs.push(job)
      return { ok: true }
    }
  })
  expect((await api.getStartup()).status).toBe('ready')
  return { api, jobs }
}

function settingsFor(labelSizeId: string, offsets: PcSettings['offsets'] = {}, printerResolution: PcSettings['printerResolution'] = 203): PcSettings {
  return { printerName: printer, printerResolution, labelSizeId, offsets, logFolder: null }
}

async function addTape(api: PreloadApi, tapeWidthMm: number, lengthMm: number): Promise<string> {
  const added = await api.addLabelSize({ kind: 'tape', name: '', tapeWidthMm, lengthMm })
  if (!added.ok) throw new Error(added.message)
  return added.sizes.find((size) => size.kind === 'tape' && size.heightMm === tapeWidthMm && size.widthMm === lengthMm)!.id
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

describe('Tape Sizes in the app', () => {
  it('are added by tape width and length, named "<w> mm tape × <l> mm" unless renamed, and laid out length × tape width', async () => {
    const { api } = await pc(await tempFolder(), 'PHARM-01')
    const added = await api.addLabelSize({ kind: 'tape', name: '', tapeWidthMm: 24, lengthMm: 40 })
    expect(added).toMatchObject({ ok: true })
    const renamed = await api.addLabelSize({ kind: 'tape', name: 'Bin tape', tapeWidthMm: 3.5, lengthMm: 150 })
    const listed = renamed.ok ? renamed.sizes : []
    expect(listed.map(({ id: _id, ...size }) => size)).toEqual([
      { name: 'Small Label', kind: 'label', widthMm: 34.4, heightMm: 25 },
      { name: '24 mm tape × 40 mm', kind: 'tape', widthMm: 40, heightMm: 24 },
      { name: 'Bin tape', kind: 'tape', widthMm: 150, heightMm: 3.5 }
    ])
    expect(await api.deleteLabelSize(listed[1].id)).toMatchObject({ ok: true, sizes: [SMALL_LABEL, listed[2]] })
  })

  it('take only the seven tape widths, a length of 10–150 mm and a name of at most 40 characters', async () => {
    const { api } = await pc(await tempFolder(), 'PHARM-01')
    expect(await api.addLabelSize({ kind: 'tape', name: '', tapeWidthMm: 25, lengthMm: 9 })).toEqual({
      ok: false,
      message: 'Tape width must be 3.5, 6, 9, 12, 18, 24 or 36 mm. Label length must be from 10 to 150 mm.'
    })
    expect(await api.addLabelSize({ kind: 'tape', name: 'x'.repeat(41), tapeWidthMm: 12, lengthMm: 151 })).toEqual({
      ok: false,
      message: 'The name must be at most 40 characters. Label length must be from 10 to 150 mm.'
    })
  })

  it('can be the loaded size, with its own offsets, and Test print shows its outline, band edges and name on the driver\'s paper', async () => {
    const folder = await tempFolder()
    const { api, jobs } = await pc(folder, 'PHARM-01')
    const added = await api.addLabelSize({ kind: 'tape', name: '', tapeWidthMm: 24, lengthMm: 40 })
    const tape = added.ok ? added.sizes[1].id : ''
    const offsets = { [SMALL_LABEL.id]: { offsetXmm: 2 * DOT_MM, offsetYmm: 0 }, [tape]: { offsetXmm: 0, offsetYmm: -3 * DOT_MM } }
    expect(await api.savePrinterSettings(settingsFor(tape, offsets))).toMatchObject({ ok: true })
    const startup = await (await pc(folder, 'PHARM-01')).api.getStartup()
    expect(startup.status === 'ready' && startup.settings).toEqual(settingsFor(tape, offsets))

    expect(await api.testPrint(settingsFor(tape, offsets))).toMatchObject({ ok: true })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({ deviceName: printer, pageSize: null, copies: 1 })
    expect(jobs[0].html).toContain(`rotate(90deg) translate(0.0000mm,${(-3 * DOT_MM).toFixed(4)}mm)`)
    expect(jobs[0].html).toContain('>24 mm tape × 40 mm</text>')
    expect(jobs[0].html).toContain('<line x1="0" y1="0.7111" x2="40" y2="0.7111"')
    expect(jobs[0].html).not.toContain('TEST01')
  })

  it('print Custom Labels from a Template made for them on the driver\'s paper, while die-cut sizes keep their page size', async () => {
    const { api, jobs } = await pc(await tempFolder(), 'PHARM-01')
    const added = await api.addLabelSize({ kind: 'tape', name: 'Bins', tapeWidthMm: 24, lengthMm: 50 })
    const tape = added.ok ? added.sizes[1].id : ''
    // The Shelf bin design moved up to fit 24 mm tape.
    const design = { ...SHELF_BIN, labelSizeId: tape, code: { ...SHELF_BIN.code, yMm: 12 }, texts: SHELF_BIN.texts.map((text) => ({ ...text, yMm: text.yMm - 2 })) }
    const saved = await api.saveTemplate(design)
    if (!saved.ok) throw new Error(saved.message)
    expect((await api.savePrinterSettings(settingsFor(tape))).ok).toBe(true)
    expect(await api.printCustomLabel({ templateId: saved.template!.id, symbology: 'datamatrix', codeValue: 'BIN-4', texts: ['top'], copies: 2 })).toMatchObject({ ok: true })
    expect(jobs[0].options).toMatchObject({ pageSize: null, copies: 2 })
    expect(jobs[0].html).toContain('html,body{margin:0;padding:0;width:24mm;height:50mm;')

    expect((await api.savePrinterSettings(settingsFor(SMALL_LABEL.id))).ok).toBe(true)
    expect(await api.testPrint(settingsFor(SMALL_LABEL.id))).toMatchObject({ ok: true })
    expect(jobs[1].options).toMatchObject({ pageSize: { width: 34_400, height: 25_000 } })
    expect(jobs[1].html).toContain('TEST01')
  })

  it("refuse a Custom Label when the driver is set to another tape, and warn when it reports none", async () => {
    for (const [paper, outcome] of [
      [{ widthMm: 36, lengthMm: null }, { ok: false, message: 'Not printed: The printer is set to 36 mm tape; set 24 mm in its Printing preferences.' }],
      [null, { ok: true, message: `Printed 1 label on ${printer}.`, warning: 'Could not check the tape width; check the printer is set to 24 mm tape.' }]
    ] as const) {
      const { api, jobs } = await pc(await tempFolder(), 'PHARM-01', { paper })
      const added = await api.addLabelSize({ kind: 'tape', name: 'Bins', tapeWidthMm: 24, lengthMm: 50 })
      const tape = added.ok ? added.sizes[1].id : ''
      const design = { ...SHELF_BIN, labelSizeId: tape, code: { ...SHELF_BIN.code, yMm: 12 }, texts: SHELF_BIN.texts.map((text) => ({ ...text, yMm: text.yMm - 2 })) }
      const saved = await api.saveTemplate(design)
      if (!saved.ok) throw new Error(saved.message)
      expect((await api.savePrinterSettings(settingsFor(tape))).ok).toBe(true)
      expect(await api.printCustomLabel({ templateId: saved.template!.id, symbology: 'datamatrix', codeValue: 'BIN-4', texts: ['top'], copies: 1 })).toEqual(outcome)
      expect(jobs).toHaveLength(outcome.ok ? 1 : 0)
    }
  })

  it('take Templates only with the code and text inside the printable band, and log their Custom Label prints as usual', async () => {
    const folder = await tempFolder()
    const { api, jobs } = await pc(folder, 'PHARM-01')
    const added = await api.addLabelSize({ kind: 'tape', name: 'Bins', tapeWidthMm: 24, lengthMm: 50 })
    const tape = added.ok ? added.sizes[1].id : ''
    const design = { ...SHELF_BIN, labelSizeId: tape, code: { ...SHELF_BIN.code, yMm: 12 }, texts: SHELF_BIN.texts.map((text) => ({ ...text, yMm: text.yMm - 2 })) }
    // 0.5 mm from the tape edge is outside the band (0.71 mm), though 1 mm inside a die-cut label is not asked of tape.
    const high = { ...design, texts: [{ ...design.texts[0], yMm: 0.5 }, design.texts[1]] }
    expect(await api.saveTemplate(high)).toEqual({ ok: false, message: 'Line 1 must be inside the printable band of the tape, at least 1 mm from the label ends.' })
    const narrow = await api.addLabelSize({ kind: 'tape', name: '', tapeWidthMm: 9, lengthMm: 50 })
    const nine = narrow.ok ? narrow.sizes.find((size) => size.heightMm === 9)!.id : ''
    expect(await api.saveTemplate({ ...design, labelSizeId: nine, texts: [], code: { ...design.code, yMm: 4.5, moduleSize: 'small' } })).toEqual({
      ok: false,
      message: 'The code with its quiet zone is taller than the printable band of 9 mm tape (7.5 mm).'
    })

    const saved = await api.saveTemplate(design)
    if (!saved.ok) throw new Error(saved.message)
    expect((await api.savePrinterSettings(settingsFor(tape, {}, 360))).ok).toBe(true)
    expect(await api.printCustomLabel({ templateId: saved.template!.id, symbology: 'qr', codeValue: 'BIN-4', texts: ['top'], copies: 1 })).toEqual({
      ok: true,
      message: `Printed 1 label on ${printer}.`,
      warning: null
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({ pageSize: null })
    const printLog = (await readdir(join(folder, 'logs'))).find((name) => name.startsWith('print-log-'))!
    expect(parseCsvLine(linesOf(await readFile(join(folder, 'logs', printLog), 'utf8'))[1]).slice(9)).toEqual(['Custom', 'Shelf bin', 'BIN-4', 'PHARMACY | top'])
  })

  it('read stored sizes without a kind as die-cut Labels', async () => {
    const folder = await tempFolder()
    await writeSealed(join(folder, 'labelsizes.dat'), [{ id: 'shelf', name: 'Shelf', widthMm: 50, heightMm: 30 }])
    const { api } = await pc(folder, 'PHARM-01')
    expect(await api.listLabelSizes()).toEqual({ ok: true, sizes: [SMALL_LABEL, { id: 'shelf', name: 'Shelf', kind: 'label', widthMm: 50, heightMm: 30 }] })
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

  it('must be the Small Label or 18, 24 or 36 mm tape for a GTIN Label', async () => {
    const { api, jobs } = await pc(await tempFolder(), 'PHARM-01', { chosenFile: itemListFixture })
    expect((await api.importItemList()).status).toBe('imported')
    const refusal = 'Not printed: GTIN Labels print on the Small Label (34.4 × 25 mm) or on 18, 24 or 36 mm tape. Change the label in Settings.'
    const shelf = await addSize(api, 'Shelf', 50, 30)
    expect((await api.savePrinterSettings(settingsFor(shelf))).ok).toBe(true)
    expect(await api.printLabel(request)).toEqual({ ok: false, message: refusal })
    const narrow = await addTape(api, 12, 40)
    expect((await api.savePrinterSettings(settingsFor(narrow))).ok).toBe(true)
    expect(await api.printLabel(request)).toEqual({ ok: false, message: refusal })
    expect(jobs).toHaveLength(0)
  })

  it('refuses a GTIN Label with the real cause when the Label Size list cannot be read, but the Small Label still prints', async () => {
    const folder = await tempFolder()
    const { api, jobs } = await pc(folder, 'PHARM-01', { chosenFile: itemListFixture })
    expect((await api.importItemList()).status).toBe('imported')
    const tape = await addTape(api, 24, 40)
    expect((await api.savePrinterSettings(settingsFor(tape))).ok).toBe(true)
    const small = await pc(folder, 'PHARM-02')
    expect((await small.api.savePrinterSettings(settingsFor(SMALL_LABEL.id))).ok).toBe(true)
    await writeFile(join(folder, 'labelsizes.dat'), 'damaged')

    expect(await api.printLabel(request)).toEqual({
      ok: false,
      message: 'Not printed: the Label Size list could not be read: The Label Sizes (labelsizes.dat) were changed outside the app.'
    })
    expect(jobs).toHaveLength(0)
    expect(await small.api.printLabel({ ...request, expiry: '31122030' })).toMatchObject({ ok: true })
    expect(small.jobs).toHaveLength(1)
  })
})

describe('GTIN Labels on tape', () => {
  /** A request the label core accepts: its Expiry is within the years scanners read. */
  const printable: LabelRequest = { ...request, expiry: '31122030' }

  async function onTape(tapeWidthMm: number, lengthMm: number, printerResolution: PcSettings['printerResolution'] = 360) {
    const app = await pc(await tempFolder(), 'PHARM-01', { chosenFile: itemListFixture, paper: { widthMm: tapeWidthMm, lengthMm: null } })
    expect((await app.api.importItemList()).status).toBe('imported')
    const tape = await addTape(app.api, tapeWidthMm, lengthMm)
    expect((await app.api.savePrinterSettings(settingsFor(tape, { [tape]: { offsetXmm: 0, offsetYmm: -3 * dotMm(printerResolution) } }, printerResolution))).ok).toBe(true)
    return app
  }

  it.each([18, 24, 36])('print on %s mm tape with the tape layout, on the driver\'s paper, turned to run along the tape', async (tapeWidthMm) => {
    const { api, jobs } = await onTape(tapeWidthMm, 40)
    expect(await api.printLabel({ ...printable, copies: 2 })).toEqual({ ok: true, message: `Printed 2 labels on ${printer}.`, warning: null })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({ deviceName: printer, pageSize: null, copies: 2 })
    expect(jobs[0].html).toContain(`html,body{margin:0;padding:0;width:${tapeWidthMm}mm;height:40mm;`)
    expect(jobs[0].html).toContain(`rotate(90deg) translate(0.0000mm,${(-3 * dotMm(360)).toFixed(4)}mm)`)
    expect(jobs[0].html).toContain(`width="40mm" height="${tapeWidthMm}mm" viewBox="0 0 40 ${tapeWidthMm}"`)
    // The 20 × 20 symbol at 7 dots a module: 20 × 7 × 25.4 / 360 = 9.8778 mm.
    expect(jobs[0].html).toContain('width="9.8778"')
    expect(jobs[0].html).toContain('>PARA01</tspan>')
  })

  it('are refused on tape too short for them, naming the minimum length, and print once it is long enough', async () => {
    const { api, jobs } = await onTape(24, 20)
    const refused = await api.printLabel(printable)
    const minimum = Number(/at least (\d+) mm long/.exec(refused.message)?.[1])
    expect(refused).toEqual({ ok: false, message: `Not printed: This GTIN Label needs tape at least ${minimum} mm long; the loaded Tape Size is 20 mm. Add a longer Tape Size in Settings.` })
    expect(minimum).toBeGreaterThan(20)
    expect(jobs).toHaveLength(0)

    const longEnough = await addTape(api, 24, minimum)
    expect((await api.savePrinterSettings(settingsFor(longEnough, {}, 360))).ok).toBe(true)
    expect(await api.printLabel(printable)).toMatchObject({ ok: true })
    expect(jobs).toHaveLength(1)
  })

  it('are what Pending Labels print, on the same rule', async () => {
    const { api, jobs } = await onTape(24, 40)
    expect(await api.savePendingLabel({ itemCode: 'PARA01', packVolumeDigit: null, expiry: '31122030', lot: 'A1', copies: 1 })).toMatchObject({ ok: true })
    const listed = await api.listPendingLabels()
    const id = listed.ok ? listed.labels[0].id : ''
    expect(await api.printPendingLabel(id, null)).toMatchObject({ ok: true })
    expect(jobs[0].options.pageSize).toBeNull()
    expect(jobs[0].html).toContain('width="40mm" height="24mm" viewBox="0 0 40 24"')

    expect(await api.savePendingLabel({ itemCode: 'PARA01', packVolumeDigit: null, expiry: '31122030', lot: 'A2', copies: 1 })).toMatchObject({ ok: true })
    const narrow = await addTape(api, 12, 40)
    expect((await api.savePrinterSettings(settingsFor(narrow, {}, 360))).ok).toBe(true)
    const again = await api.listPendingLabels()
    expect(await api.printPendingLabel(again.ok ? again.labels[0].id : '', null)).toEqual({
      ok: false,
      message: 'Not printed: GTIN Labels print on the Small Label (34.4 × 25 mm) or on 18, 24 or 36 mm tape. Change the label in Settings.'
    })
    expect(jobs).toHaveLength(1)
  })
})

/** A new Template made in the designer for the Shelf size (50 × 30 mm): a fixed line and a fill-in line beside the code. */
const SHELF_BIN: Template = {
  id: '',
  name: 'Shelf bin',
  labelSizeId: 'shelf',
  builtIn: false,
  code: { xMm: 10, yMm: 15, symbology: 'datamatrix', moduleSize: 'medium', mode: 'fill' },
  texts: [
    { id: 'line-1', xMm: 20, yMm: 10, widthMm: 28, align: 'left', fontSizePt: 10, bold: true, mode: 'fixed', value: 'PHARMACY' },
    { id: 'line-2', xMm: 20, yMm: 16, widthMm: 28, align: 'left', fontSizePt: 8, bold: false, mode: 'fill' }
  ]
}

describe('Templates in the app', () => {
  async function twoPcs() {
    const folder = await tempFolder()
    const one = await pc(folder, 'PHARM-01')
    const two = await pc(folder, 'PHARM-02')
    const shelf = await addSize(one.api, 'Shelf', 50, 30)
    return { folder, one, two, shelf, design: { ...SHELF_BIN, labelSizeId: shelf } }
  }

  it('are saved for any Label Size, shared with every PC after the built-ins', async () => {
    const { one, two, design } = await twoPcs()
    const saved = await one.api.saveTemplate(design)
    expect(saved).toMatchObject({ ok: true, warning: null, template: { ...design, id: expect.any(String) } })
    const listed = await two.api.listTemplates()
    expect(listed.ok && listed.templates.map((template) => template.name)).toEqual(['Layout 1', 'Layout 2', 'Shelf bin'])
  })

  it('are refused, with the reason, while the layout is not valid or the request is not a Template', async () => {
    const { one, design } = await twoPcs()
    const overlap = { ...design, texts: [{ ...design.texts[0], xMm: 15 }, design.texts[1]] }
    expect(await one.api.saveTemplate(overlap)).toEqual({ ok: false, message: 'Line 1 overlaps the code.' })
    expect(await one.api.saveTemplate({ ...design, labelSizeId: 'gone' })).toEqual({ ok: false, message: 'That label size is no longer in the list.' })
    expect(await one.api.saveTemplate({ ...design, code: null } as unknown as Template)).toEqual({ ok: false, message: 'The template is not valid.' })
    expect(await one.api.listTemplates()).toEqual({ ok: true, templates: [LAYOUT_1, LAYOUT_2] })
  })

  it('copy, rename and delete, each returning the list after', async () => {
    const { one, two } = await twoPcs()
    const copied = await one.api.copyTemplate(LAYOUT_2.id, 'My layout')
    if (!copied.ok) throw new Error(copied.message)
    const id = copied.template!.id
    expect(copied.templates.map((template) => template.name)).toEqual(['Layout 1', 'Layout 2', 'My layout'])
    // A copy keeps Layout 2's exact positions, and can be saved with them.
    expect(await two.api.saveTemplate({ ...copied.template!, texts: copied.template!.texts.slice(0, 3) })).toMatchObject({ ok: true })
    expect(await two.api.renameTemplate(id, 'Bins')).toMatchObject({ ok: true, template: { id, name: 'Bins' } })
    expect(await one.api.renameTemplate(LAYOUT_1.id, 'Mine')).toEqual({ ok: false, message: 'Layout 1 is built in and cannot be changed. Copy it to make your own.' })
    const deleted = await one.api.deleteTemplate(id)
    expect(deleted).toEqual({ ok: true, templates: [LAYOUT_1, LAYOUT_2], template: null, warning: null })
  })

  it('log every save, copy, rename and delete in this PC’s template log, refused or not', async () => {
    const { folder, one, design } = await twoPcs()
    const saved = await one.api.saveTemplate(design)
    if (!saved.ok) throw new Error(saved.message)
    const id = saved.template!.id
    await one.api.saveTemplate({ ...design, name: 'layout 1' })
    await one.api.renameTemplate(id, 'Bin')
    await one.api.copyTemplate(id, 'Bin 2')
    await one.api.deleteTemplate(id)
    const logs = await readdir(join(folder, 'logs'))
    const name = logs.find((file) => file.startsWith('template-log-'))!
    expect(name).toMatch(/^template-log-\d{4}-\d{2}-PHARM-01\.csv$/)
    const lines = linesOf(await readFile(join(folder, 'logs', name), 'utf8'))
    expect(lines[0]).toBe('Date Time,Windows User,PC,Action,Template,Result')
    expect(lines.slice(1).map((line) => parseCsvLine(line).slice(1))).toEqual([
      ['chantm', 'PHARM-01', 'Save', 'Shelf bin', 'Saved'],
      ['chantm', 'PHARM-01', 'Save', 'layout 1', 'Refused: There is already a template named "Layout 1".'],
      ['chantm', 'PHARM-01', 'Rename', 'Shelf bin → Bin', 'Renamed'],
      ['chantm', 'PHARM-01', 'Copy', 'Bin → Bin 2', 'Copied'],
      ['chantm', 'PHARM-01', 'Delete', 'Bin', 'Deleted']
    ])
  })

  it('keep their Label Size from being deleted', async () => {
    const { one, two, shelf, design } = await twoPcs()
    const saved = await one.api.saveTemplate(design)
    if (!saved.ok) throw new Error(saved.message)
    expect(await two.api.deleteLabelSize(shelf)).toEqual({ ok: false, message: 'The label size "Shelf" is used by a Template and cannot be deleted.' })
    await one.api.deleteTemplate(saved.template!.id)
    expect(await two.api.deleteLabelSize(shelf)).toEqual({ ok: true, sizes: [SMALL_LABEL] })
  })
})

describe('Custom Labels', () => {
  const custom: CustomLabelRequest = { templateId: LAYOUT_2.id, symbology: 'qr', codeValue: 'Bin #4 (top)', texts: ['Bin 4', '', 'top shelf', ''], copies: 2 }

  async function setUp() {
    const folder = await tempFolder()
    const one = await pc(folder, 'PHARM-01')
    expect((await one.api.savePrinterSettings(settingsFor(SMALL_LABEL.id, { [SMALL_LABEL.id]: { offsetXmm: 3 * DOT_MM, offsetYmm: 0 } }))).ok).toBe(true)
    return { folder, ...one }
  }

  it('lists the built-in Layouts 1 and 2', async () => {
    const { api } = await setUp()
    expect(await api.listTemplates()).toEqual({ ok: true, templates: [LAYOUT_1, LAYOUT_2] })
  })

  it('still print from the built-in Layouts when templates.dat is damaged', async () => {
    const { folder, api, jobs } = await setUp()
    await writeFile(join(folder, 'templates.dat'), 'damaged')
    expect(await api.listTemplates()).toMatchObject({ ok: false })
    expect(await api.printCustomLabel(custom)).toMatchObject({ ok: true })
    expect(jobs).toHaveLength(1)
  })

  it('print on the loaded Small Label with its offsets, and are logged as Custom', async () => {
    const { folder, api, jobs } = await setUp()
    expect(await api.printCustomLabel(custom)).toEqual({ ok: true, message: 'Printed 2 labels on ZDesigner GX420t.', warning: null })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({ pageSize: { width: 34_400, height: 25_000 }, copies: 2 })
    expect(jobs[0].html).toContain(`translate(${(3 * DOT_MM).toFixed(4)}mm,0.0000mm)`)
    expect(jobs[0].html).toContain('>Bin 4</tspan>')
    const [logName] = await readdir(join(folder, 'logs'))
    const lines = linesOf(await readFile(join(folder, 'logs', logName), 'utf8'))
    expect(lines[0].endsWith(',Copies,Kind,Template,Code data,Text')).toBe(true)
    expect(parseCsvLine(lines[1]).slice(1)).toEqual(['chantm', 'PHARM-01', '', '', '', '', '', '2', 'Custom', 'Layout 2', 'Bin #4 (top)', 'Bin 4 |  | top shelf | '])
  })

  it('are rebuilt and checked before printing: what the screen would refuse never prints', async () => {
    const { api, jobs } = await setUp()
    expect(await api.printCustomLabel({ ...custom, texts: ['', 'WWWWWWWWWWWWWWWW', '', ''] })).toEqual({ ok: false, message: 'Not printed: Line 2 is too long for this template.' })
    expect(await api.printCustomLabel({ ...custom, codeValue: 'a;b', copies: 0 })).toEqual({
      ok: false,
      message: 'Not printed: The code data may hold only A–Z, a–z, 0–9, space and - _ . / : # ( ) + *. Copies must be a whole number from 1 to 99.'
    })
    expect(await api.printCustomLabel({ ...custom, templateId: 'nope' })).toEqual({ ok: false, message: 'Not printed: that template is no longer there.' })
    expect(await api.printCustomLabel({ ...custom, symbology: 'aztec' } as unknown as CustomLabelRequest)).toEqual({ ok: false, message: 'Not printed: the label request is not valid.' })
    expect(await api.printCustomLabel({ ...custom, texts: [1, 2, 3, 4] } as unknown as CustomLabelRequest)).toEqual({ ok: false, message: 'Not printed: the label request is not valid.' })
    expect(jobs).toHaveLength(0)
  })

  it('print from a saved Template on its own Label Size, asking only its fill-in lines', async () => {
    const { folder, api, jobs } = await setUp()
    const shelf = await addSize(api, 'Shelf', 50, 30)
    const saved = await api.saveTemplate({ ...SHELF_BIN, labelSizeId: shelf })
    if (!saved.ok) throw new Error(saved.message)
    const request = { templateId: saved.template!.id, symbology: 'datamatrix', codeValue: 'BIN-4', texts: ['top shelf'], copies: 1 } as const
    expect(await api.printCustomLabel(request)).toMatchObject({ ok: false, message: expect.stringContaining('This template was made for Shelf (50 × 30 mm)') })
    expect((await api.savePrinterSettings(settingsFor(shelf))).ok).toBe(true)
    expect(await api.printCustomLabel({ ...request, texts: ['top shelf', 'extra'] })).toEqual({ ok: false, message: 'Not printed: The text lines do not match this template.' })
    expect(await api.printCustomLabel(request)).toMatchObject({ ok: true })
    expect(jobs[0].html).toContain('>PHARMACY</tspan>')
    expect(jobs[0].html).toContain('>top shelf</tspan>')
    const printLog = (await readdir(join(folder, 'logs'))).find((name) => name.startsWith('print-log-'))!
    expect(parseCsvLine(linesOf(await readFile(join(folder, 'logs', printLog), 'utf8'))[1]).slice(9)).toEqual(['Custom', 'Shelf bin', 'BIN-4', 'PHARMACY | top shelf'])
  })

  it('are refused when another Label Size is loaded, naming both', async () => {
    const { api, jobs } = await setUp()
    const shelf = await addSize(api, 'Shelf', 50, 30)
    expect((await api.savePrinterSettings(settingsFor(shelf))).ok).toBe(true)
    expect(await api.printCustomLabel(custom)).toEqual({
      ok: false,
      message: 'Not printed: This template was made for Small Label (34.4 × 25 mm); this PC prints Shelf (50 × 30 mm). Change the label in Settings.'
    })
    expect(jobs).toHaveLength(0)
  })
})

describe('Printer resolution', () => {
  /** The width the symbol is drawn at in a printed page, e.g. `width="10.0099"`. */
  const symbolWidth = (mm: number) => `width="${mm.toFixed(4)}"`

  it('reads as 203 dpi from settings saved before it existed', async () => {
    const folder = await tempFolder()
    await writeSealed(pcSettingsPath(folder, 'PHARM-01'), { printerName: printer, labelSizeId: SMALL_LABEL.id, offsets: {}, logFolder: null })
    const startup = await (await pc(folder, 'PHARM-01')).api.getStartup()
    expect(startup.status === 'ready' && startup.settings).toEqual(settingsFor(SMALL_LABEL.id))
  })

  it('is kept per PC, with the offsets snapped to whole dots at it', async () => {
    const folder = await tempFolder()
    const { api } = await pc(folder, 'PHARM-01')
    const saved = await api.savePrinterSettings(settingsFor(SMALL_LABEL.id, { [SMALL_LABEL.id]: { offsetXmm: 0.3, offsetYmm: -0.2 } }, 360))
    // 0.3 mm is 4.25 dots at 360 dpi, -0.2 mm is -2.83: 4 and -3 dots of 25.4 / 360 mm.
    expect(saved.ok && saved.settings.offsets[SMALL_LABEL.id].offsetXmm).toBeCloseTo((4 * 25.4) / 360, 12)
    expect(saved.ok && saved.settings.offsets[SMALL_LABEL.id].offsetYmm).toBeCloseTo((-3 * 25.4) / 360, 12)
    const startup = await (await pc(folder, 'PHARM-01')).api.getStartup()
    expect(startup.status === 'ready' && startup.settings?.printerResolution).toBe(360)
    expect(await api.savePrinterSettings({ ...settingsFor(SMALL_LABEL.id), printerResolution: 600 as never })).toMatchObject({ ok: false })
  })

  it('sizes a GTIN Label’s modules: 4 dots at 203 dpi as before, 7 dots at 360 dpi', async () => {
    const { api, jobs } = await pc(await tempFolder(), 'PHARM-01')
    expect((await api.savePrinterSettings(settingsFor(SMALL_LABEL.id))).ok).toBe(true)
    expect(await api.testPrint(settingsFor(SMALL_LABEL.id))).toMatchObject({ ok: true })
    expect(await api.testPrint(settingsFor(SMALL_LABEL.id, {}, 360))).toMatchObject({ ok: true })
    // The 20 × 20 symbol: 20 × 4 × 25.4 / 203 = 10.0099 mm; 20 × 7 × 25.4 / 360 = 9.8778 mm.
    expect(jobs[0].html).toContain(symbolWidth(10.0099))
    expect(jobs[1].html).toContain(symbolWidth(9.8778))
  })

  it('sizes a Custom Label’s modules at this PC’s resolution', async () => {
    const custom: CustomLabelRequest = { templateId: LAYOUT_2.id, symbology: 'datamatrix', codeValue: 'BIN-4', texts: ['', '', '', ''], copies: 1 }
    for (const [dpi, mm] of [
      [203, 9.7596], // Small: 3 dots, 26 × 3 × 25.4 / 203
      [300, 8.8053], // 4 dots, 26 × 4 × 25.4 / 300
      [360, 9.1722] // 5 dots, 26 × 5 × 25.4 / 360
    ] as const) {
      const { api, jobs } = await pc(await tempFolder(), 'PHARM-01')
      expect((await api.savePrinterSettings(settingsFor(SMALL_LABEL.id, {}, dpi))).ok).toBe(true)
      expect(await api.printCustomLabel(custom)).toMatchObject({ ok: true })
      expect(jobs[0].html).toContain(symbolWidth(mm))
    }
  })

  it('reads Templates saved with dots per module as Small, Medium or Large', async () => {
    const folder = await tempFolder()
    const { api } = await pc(folder, 'PHARM-01')
    const shelf = await addSize(api, 'Shelf', 50, 30)
    const stored = [3, 4, 5].map((dots) => {
      const { moduleSize: _, ...code } = SHELF_BIN.code
      return { ...SHELF_BIN, id: `t${dots}`, name: `Bin ${dots}`, labelSizeId: shelf, code: { ...code, dotsPerModule: dots } }
    })
    await writeSealed(templatesPath(folder), stored)
    const listed = await api.listTemplates()
    expect(listed.ok && listed.templates.slice(2).map((template) => template.code.moduleSize)).toEqual(['small', 'medium', 'large'])
    expect(listed.ok && listed.templates.slice(0, 2)).toEqual([LAYOUT_1, LAYOUT_2])
    expect(LAYOUT_1.code.moduleSize).toBe('small')
  })

  it('refuses a Template whose code fits at one resolution but not at another', async () => {
    const { api } = await pc(await tempFolder(), 'PHARM-01')
    // A Large QR code is 18.14 mm at 203 dpi (5 dots) but 18.42 mm at 360 dpi (9 dots), plus its quiet zone.
    const strip = await addSize(api, 'Strip', 40, 23.7)
    const design: Template = { ...SHELF_BIN, labelSizeId: strip, code: { ...SHELF_BIN.code, xMm: 20, yMm: 12, moduleSize: 'large' }, texts: [] }
    expect(await api.saveTemplate(design)).toEqual({ ok: false, message: 'The code must be at least 1 mm inside the label.' })
    expect(await api.saveTemplate({ ...design, code: { ...design.code, moduleSize: 'medium' } })).toMatchObject({ ok: true })
  })
})
