import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexItems } from '../core/itemList'
import type { PendingLabelInput } from '../core/pendingLabel'
import { addPending } from '../data/pendingStore'
import { appendPrintLog, PRINT_LOG_HEADER } from '../data/printLog'
import { tempFolder } from '../data/testFolder'
import { DOT_MM } from '../render/dataMatrix'
import type { LabelPrintJob } from '../render/printJob'
import { SMALL_LABEL, type PcSettings } from '../render/printSettings'
import { deleteExpiredPendingLabels, deletePendingLabel, listPendingLabels, printPendingLabel, savePendingLabel } from './pendingService'
import type { DriverResult, PrintServiceDeps } from './printService'

const settings: PcSettings = { printerName: 'ZDesigner GX420t', labelSizeId: SMALL_LABEL.id, offsets: { [SMALL_LABEL.id]: { offsetXmm: 2 * DOT_MM, offsetYmm: 0 } }, logFolder: null }

const before = indexItems([{ itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' }])
const after = indexItems([
  { itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' },
  { itemCode: 'NEW001', name: 'SYNTHETIC NEWDRUG TABLET', baseUnit: 'TAB' },
  { itemCode: 'NEW002', name: 'SYNTHETIC NEWDRUG ORAL SOLUTION', baseUnit: 'ML' }
])

/** 19 Oct 2026 14:03:07 local time. */
const now = new Date(2026, 9, 19, 14, 3, 7)
const today = '2026-10-19'

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
  const list = await listPendingLabels(dataFolder, index, today)
  if (!list.ok || list.labels.length === 0) throw new Error('expected a Pending Label')
  return list.labels[0]
}

describe('Pending Labels', () => {
  it('saves a request whose Item Code is not in the Item List, then shows it ready once a newer list has it', async () => {
    const { dataFolder, context, deps } = await setup()
    const saved = await savePendingLabel(tablet, context, deps)
    expect(saved.ok).toBe(true)

    const waiting = await listPendingLabels(dataFolder, before, today)
    expect(waiting).toMatchObject({ ok: true, labels: [{ itemCode: 'NEW001', lot: '2512172-1', copies: 2, savedBy: 'chantm', pc: 'PHARM-01', status: 'waiting' }] })

    const ready = await listPendingLabels(dataFolder, after, today)
    expect(ready).toMatchObject({ ok: true, labels: [{ itemCode: 'NEW001', status: 'ready', itemName: 'SYNTHETIC NEWDRUG TABLET', liquid: false }] })
  })

  it('waits when no Item List is imported', async () => {
    const { dataFolder, context, deps } = await setup()
    await savePendingLabel(tablet, context, deps)
    expect(await listPendingLabels(dataFolder, null, today)).toMatchObject({ ok: true, labels: [{ status: 'waiting' }] })
  })

  it('refuses to save what the label core would refuse', async () => {
    const { dataFolder, context, deps } = await setup()
    for (const bad of [{ ...tablet, lot: '' }, { ...tablet, expiry: '01012020' }, { ...tablet, itemCode: 'AB' }, { ...tablet, copies: 0 }, { ...tablet, packVolumeDigit: 9 }]) {
      expect((await savePendingLabel(bad, context, deps)).ok).toBe(false)
    }
    expect((await savePendingLabel('nonsense', context, deps)).ok).toBe(false)
    expect(await listPendingLabels(dataFolder, after, today)).toEqual({ ok: true, labels: [] })
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

    expect(await listPendingLabels(dataFolder, after, today)).toEqual({ ok: true, labels: [] })
  })

  it('keeps a Pending Label unprinted unless the Small Label is loaded', async () => {
    const { dataFolder, context, deps, jobs } = await setup()
    await savePendingLabel(tablet, context, deps)
    const { id } = await firstPending(dataFolder, after)
    expect(await printPendingLabel(id, null, { ...settings, labelSizeId: 'other' }, after, context, deps)).toEqual({
      ok: false,
      message: 'Not printed: GTIN Labels print on the Small Label (34.4 × 25 mm). Change the label in Settings.'
    })
    expect(jobs).toHaveLength(0)
    expect((await firstPending(dataFolder, after)).id).toBe(id)
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
    expect(await listPendingLabels(dataFolder, before, today)).toMatchObject({ labels: [{ id }] })
  })

  it('puts a Pending Label back when the printer fails, and logs nothing', async () => {
    const { dataFolder, context, deps, logFile } = await setup({ ok: false, reason: 'out of labels' })
    await savePendingLabel(tablet, context, deps)
    const { id } = (await firstPending(dataFolder, after))
    const outcome = await printPendingLabel(id, null, settings, after, context, deps)
    expect(outcome).toEqual({ ok: false, message: expect.stringContaining('out of labels') })
    expect(await listPendingLabels(dataFolder, after, today)).toMatchObject({ labels: [{ id }] })
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
    expect(await listPendingLabels(dataFolder, after, today)).toEqual({ ok: true, labels: [] })
    expect(jobs).toHaveLength(0)
  })

  describe('expired', () => {
    /** Saved on another day, so its Expiry has since passed (a save today would be refused). */
    async function addDirect(dataFolder: string, itemCode: string, expiry: string, pc = 'PHARM-02') {
      const added = await addPending(dataFolder, { itemCode, packVolumeDigit: null, expiry, lot: 'L1', copies: 1, savedBy: 'chantm', pc })
      if (!added.ok) throw new Error(added.message)
      return added.value
    }

    it('lists an expired Pending Label as expired, even when its Item Code is listed', async () => {
      const { dataFolder } = await setup()
      await addDirect(dataFolder, 'NEW001', '18102026')
      await addDirect(dataFolder, 'NEW001', '19102026')
      const list = await listPendingLabels(dataFolder, after, today)
      expect(list).toMatchObject({ ok: true, labels: [{ status: 'expired' }, { status: 'ready' }] })
    })

    it('refuses to print an expired one with a clear message, and keeps it', async () => {
      const { dataFolder, context, deps, jobs } = await setup()
      const expired = await addDirect(dataFolder, 'NEW001', '18102026')
      const outcome = await printPendingLabel(expired.id, null, settings, after, context, deps)
      expect(outcome).toEqual({ ok: false, message: expect.stringMatching(/Not printed: .*NEW001.*expired.*18 OCT 2026/) })
      expect(jobs).toHaveLength(0)
      expect(await listPendingLabels(dataFolder, after, today)).toMatchObject({ labels: [{ id: expired.id, status: 'expired' }] })
    })

    it('deletes only the expired ones and reports how many', async () => {
      const { dataFolder } = await setup()
      await addDirect(dataFolder, 'NEW001', '18102026')
      await addDirect(dataFolder, 'ZZZ999', '01012026')
      const live = await addDirect(dataFolder, 'NEW001', '19102026')
      const waiting = await addDirect(dataFolder, 'ZZZ999', '31122027')
      expect(await deleteExpiredPendingLabels(dataFolder, today)).toEqual({ ok: true, deleted: 2 })
      const list = await listPendingLabels(dataFolder, after, today)
      expect(list).toMatchObject({ ok: true, labels: [{ id: live.id }, { id: waiting.id }] })
      expect(await deleteExpiredPendingLabels(dataFolder, today)).toEqual({ ok: true, deleted: 0 })
    })

    it('loses no update when two PCs delete expired ones while a third saves', async () => {
      const { dataFolder, context, deps } = await setup()
      for (let i = 0; i < 5; i++) await addDirect(dataFolder, `OLD00${i}`, '01012026')
      const [first, second, saved] = await Promise.all([
        deleteExpiredPendingLabels(dataFolder, today),
        deleteExpiredPendingLabels(dataFolder, today),
        savePendingLabel(tablet, { ...context, pcName: 'PHARM-03' }, deps)
      ])
      expect(saved.ok).toBe(true)
      expect(first.ok && second.ok).toBe(true)
      expect((first.ok ? first.deleted : 0) + (second.ok ? second.deleted : 0)).toBe(5)
      expect(await listPendingLabels(dataFolder, null, today)).toMatchObject({ ok: true, labels: [{ itemCode: 'NEW001', status: 'waiting' }] })
    })
  })
})
