import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexItems } from '../core/itemList'
import type { PendingLabelInput } from '../core/pendingLabel'
import { appendPrintLog, PRINT_LOG_HEADER } from '../data/printLog'
import { tempFolder } from '../data/testFolder'
import { DOT_MM } from '../render/dataMatrix'
import type { LabelPrintJob } from '../render/printJob'
import type { PcSettings } from '../render/printSettings'
import { deletePendingLabel, listPendingLabels, printPendingLabel, savePendingLabel } from './pendingService'
import type { DriverResult, PrintServiceDeps } from './printService'

const settings: PcSettings = { printerName: 'ZDesigner GX420t', labelSize: { widthMm: 30, heightMm: 20 }, offsetXmm: 2 * DOT_MM, offsetYmm: 0, logFolder: null }

const before = indexItems([{ itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' }])
const after = indexItems([
  { itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' },
  { itemCode: 'NEW001', name: 'SYNTHETIC NEWDRUG TABLET', baseUnit: 'TAB' },
  { itemCode: 'NEW002', name: 'SYNTHETIC NEWDRUG ORAL SOLUTION', baseUnit: 'ML' }
])

/** 19 Oct 2026 14:03:07 local time. */
const now = new Date(2026, 9, 19, 14, 3, 7)

const tablet: PendingLabelInput = { itemCode: 'new001', packVolumeDigit: null, expiry: '31122027', lot: '2512172-1', copies: 2 }

async function setup(driver: DriverResult = { ok: true }) {
  const dataFolder = await tempFolder()
  const jobs: LabelPrintJob[] = []
  const deps: PrintServiceDeps = {
    now: () => now,
    sendToPrinter: async (job) => {
      jobs.push(job)
      return driver
    },
    appendLog: appendPrintLog
  }
  const context = { dataFolder, pcName: 'PHARM-01', windowsUser: 'chantm' }
  const logFile = join(dataFolder, 'logs', 'print-log-2026-10-PHARM-01.csv')
  return { dataFolder, jobs, deps, context, logFile }
}

/** The first Pending Label listed. */
async function firstPending(dataFolder: string, index: Parameters<typeof listPendingLabels>[1]) {
  const list = await listPendingLabels(dataFolder, index)
  if (!list.ok || list.labels.length === 0) throw new Error('expected a Pending Label')
  return list.labels[0]
}

describe('Pending Labels', () => {
  it('saves a request whose Item Code is not in the Item List, then shows it ready once a newer list has it', async () => {
    const { dataFolder, context, deps } = await setup()
    const saved = await savePendingLabel(tablet, context, deps)
    expect(saved.ok).toBe(true)

    const waiting = await listPendingLabels(dataFolder, before)
    expect(waiting).toMatchObject({ ok: true, labels: [{ itemCode: 'NEW001', lot: '2512172-1', copies: 2, savedBy: 'chantm', pc: 'PHARM-01', status: 'waiting' }] })

    const ready = await listPendingLabels(dataFolder, after)
    expect(ready).toMatchObject({ ok: true, labels: [{ itemCode: 'NEW001', status: 'ready', itemName: 'SYNTHETIC NEWDRUG TABLET', liquid: false }] })
  })

  it('waits when no Item List is imported', async () => {
    const { dataFolder, context, deps } = await setup()
    await savePendingLabel(tablet, context, deps)
    expect(await listPendingLabels(dataFolder, null)).toMatchObject({ ok: true, labels: [{ status: 'waiting' }] })
  })

  it('refuses to save what the label core would refuse', async () => {
    const { dataFolder, context, deps } = await setup()
    for (const bad of [{ ...tablet, lot: '' }, { ...tablet, expiry: '01012020' }, { ...tablet, itemCode: 'AB' }, { ...tablet, copies: 0 }, { ...tablet, packVolumeDigit: 9 }]) {
      expect((await savePendingLabel(bad, context, deps)).ok).toBe(false)
    }
    expect((await savePendingLabel('nonsense', context, deps)).ok).toBe(false)
    expect(await listPendingLabels(dataFolder, after)).toEqual({ ok: true, labels: [] })
  })

  it('prints a ready Pending Label with one call, logs it like any print and removes it', async () => {
    const { dataFolder, context, deps, jobs, logFile } = await setup()
    await savePendingLabel(tablet, context, deps)
    const { id } = await firstPending(dataFolder, after)

    const outcome = await printPendingLabel(id, null, settings, after, context, deps)
    expect(outcome).toEqual({ ok: true, message: 'Printed 2 labels on ZDesigner GX420t.', warning: null })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({ copies: 2 })

    const log = (await readFile(logFile, 'utf8')).split('\r\n').filter(Boolean)
    expect(log[0]).toContain(PRINT_LOG_HEADER[3])
    expect(log).toHaveLength(2)
    expect(log[1]).toContain('NEW001')
    expect(log[1]).toContain('2512172-1')

    expect(await listPendingLabels(dataFolder, after)).toEqual({ ok: true, labels: [] })
  })

  it('does not print a Pending Label twice', async () => {
    const { dataFolder, context, deps, jobs } = await setup()
    await savePendingLabel(tablet, context, deps)
    const { id } = (await firstPending(dataFolder, after))
    const [first, second] = await Promise.all([
      printPendingLabel(id, null, settings, after, context, deps),
      printPendingLabel(id, null, settings, after, context, deps)
    ])
    expect([first.ok, second.ok].sort()).toEqual([false, true])
    expect(jobs).toHaveLength(1)
  })

  it('refuses one whose Item Code is still not listed, and keeps it', async () => {
    const { dataFolder, context, deps, jobs } = await setup()
    await savePendingLabel(tablet, context, deps)
    const { id } = (await firstPending(dataFolder, before))
    const outcome = await printPendingLabel(id, null, settings, before, context, deps)
    expect(outcome).toEqual({ ok: false, message: expect.stringContaining('not in the Item List') })
    expect(jobs).toHaveLength(0)
    expect(await listPendingLabels(dataFolder, before)).toMatchObject({ labels: [{ id }] })
  })

  it('puts a Pending Label back when the printer fails, and logs nothing', async () => {
    const { dataFolder, context, deps, logFile } = await setup({ ok: false, reason: 'out of labels' })
    await savePendingLabel(tablet, context, deps)
    const { id } = (await firstPending(dataFolder, after))
    const outcome = await printPendingLabel(id, null, settings, after, context, deps)
    expect(outcome).toEqual({ ok: false, message: expect.stringContaining('out of labels') })
    expect(await listPendingLabels(dataFolder, after)).toMatchObject({ labels: [{ id }] })
    await expect(readFile(logFile)).rejects.toThrow()
  })

  it('needs a Pack Volume for a liquid saved without one', async () => {
    const { dataFolder, context, deps, jobs } = await setup()
    await savePendingLabel({ ...tablet, itemCode: 'NEW002' }, context, deps)
    const { id } = (await firstPending(dataFolder, after))
    expect(await printPendingLabel(id, null, settings, after, context, deps)).toEqual({ ok: false, message: expect.stringContaining('Pack Volume') })
    expect(jobs).toHaveLength(0)
    expect((await printPendingLabel(id, 2, settings, after, context, deps)).ok).toBe(true)
    expect(jobs).toHaveLength(1)
  })

  it('deletes a Pending Label without printing', async () => {
    const { dataFolder, context, deps, jobs } = await setup()
    await savePendingLabel(tablet, context, deps)
    const { id } = (await firstPending(dataFolder, after))
    expect(await deletePendingLabel(dataFolder, id)).toEqual({ ok: true })
    expect(await deletePendingLabel(dataFolder, id)).toMatchObject({ ok: false })
    expect(await listPendingLabels(dataFolder, after)).toEqual({ ok: true, labels: [] })
    expect(jobs).toHaveLength(0)
  })
})
