import { utimes, writeFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { MAX_PENDING_LABELS, type PendingLabel } from '../core/pendingLabel'
import { addPending, pendingLockPath, pendingPath, readPending, removePending, restorePending, STALE_LOCK_MS, type PendingStoreDeps } from './pendingStore'
import { tempFolder } from './testFolder'

const input = { itemCode: 'NEW001', packVolumeDigit: null, expiry: '31122027', lot: 'A1', copies: 2, savedBy: 'chantm', pc: 'PHARM-01' } as const

const deps = (now = new Date(2026, 9, 19, 9, 0, 0)): PendingStoreDeps => ({ now: () => now, sleep: async () => undefined })

/** Real timers, a tenth of the usual waits, so a held lock is waited out for real. */
const realDeps: PendingStoreDeps = { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / 10)) }

describe('Pending Labels store', () => {
  it('has none before the first is saved', async () => {
    expect(await readPending(await tempFolder())).toEqual({ ok: true, labels: [] })
  })

  it('saves, lists and deletes', async () => {
    const folder = await tempFolder()
    const saved = await addPending(folder, input, deps())
    expect(saved.ok && saved.value).toMatchObject({ ...input, savedAt: new Date(2026, 9, 19, 9, 0, 0).toISOString() })
    const listed = await readPending(folder)
    expect(listed).toEqual({ ok: true, labels: [(saved as { value: PendingLabel }).value] })

    const removed = await removePending(folder, (saved as { value: PendingLabel }).value.id)
    expect(removed.ok).toBe(true)
    expect(await readPending(folder)).toEqual({ ok: true, labels: [] })
    expect(await readdir(folder)).toEqual(['pending.dat'])
  })

  it('refuses to remove a Pending Label another PC already removed', async () => {
    const folder = await tempFolder()
    const saved = (await addPending(folder, input, deps())) as { value: PendingLabel }
    expect((await removePending(folder, saved.value.id)).ok).toBe(true)
    expect(await removePending(folder, saved.value.id)).toEqual({ ok: false, message: expect.stringContaining('no longer there') })
  })

  it('restores a removed Pending Label once only', async () => {
    const folder = await tempFolder()
    const saved = (await addPending(folder, input, deps())) as { value: PendingLabel }
    await removePending(folder, saved.value.id)
    await restorePending(folder, saved.value)
    await restorePending(folder, saved.value)
    expect(await readPending(folder)).toEqual({ ok: true, labels: [saved.value] })
  })

  it('loses no update when two PCs save at the same time', async () => {
    const folder = await tempFolder()
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => addPending(folder, { ...input, lot: `L${index}`, pc: index % 2 ? 'PHARM-01' : 'PHARM-02' }, realDeps))
    )
    expect(results.every((result) => result.ok)).toBe(true)
    const listed = await readPending(folder)
    expect(listed.ok && listed.labels.map((label) => label.lot).sort()).toEqual(Array.from({ length: 6 }, (_, index) => `L${index}`).sort())
  })

  it('loses no update when saves and deletes overlap', async () => {
    const folder = await tempFolder()
    const first = (await addPending(folder, input, realDeps)) as { value: PendingLabel }
    const [removed, added] = await Promise.all([removePending(folder, first.value.id, realDeps), addPending(folder, { ...input, lot: 'B2' }, realDeps)])
    expect(removed.ok && added.ok).toBe(true)
    const listed = await readPending(folder)
    expect(listed.ok && listed.labels.map((label) => label.lot)).toEqual(['B2'])
  })

  it('waits for a lock another PC holds, then gives up without writing', async () => {
    const folder = await tempFolder()
    await writeFile(pendingLockPath(folder), 'PHARM-02')
    const result = await addPending(folder, input, deps(new Date()))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('another PC') })
    expect(await readPending(folder)).toEqual({ ok: true, labels: [] })
  })

  it('takes over a stale lock', async () => {
    const folder = await tempFolder()
    await writeFile(pendingLockPath(folder), 'PHARM-02 stopped mid-change')
    const old = new Date(Date.now() - STALE_LOCK_MS - 1000)
    await utimes(pendingLockPath(folder), old, old)
    const result = await addPending(folder, input, realDeps)
    expect(result.ok).toBe(true)
    expect(await readdir(folder)).toEqual(['pending.dat'])
  })

  it('keeps a fresh lock even when this PC clock is far ahead of the file server', async () => {
    const folder = await tempFolder()
    await writeFile(pendingLockPath(folder), 'PHARM-02')
    const result = await addPending(folder, input, deps(new Date(Date.now() + 10 * 60_000)))
    expect(result).toEqual({ ok: false, message: expect.stringContaining('another PC') })
    expect(await readdir(folder)).toEqual(['pending.lock'])
  })

  it('takes over a lock older than the limit by the file server clock, whatever this PC clock says', async () => {
    const folder = await tempFolder()
    await writeFile(pendingLockPath(folder), 'PHARM-02 stopped mid-change')
    const old = new Date(Date.now() - STALE_LOCK_MS - 1000)
    await utimes(pendingLockPath(folder), old, old)
    const result = await addPending(folder, input, { ...realDeps, now: () => new Date(Date.now() - 10 * 60_000) })
    expect(result.ok).toBe(true)
    expect(await readdir(folder)).toEqual(['pending.dat'])
  })

  it('does not write a file that was changed outside the app', async () => {
    const folder = await tempFolder()
    await writeFile(pendingPath(folder), 'not a sealed file')
    const result = await addPending(folder, input, deps())
    expect(result).toEqual({ ok: false, message: expect.stringContaining('changed outside the app') })
    expect(await readdir(folder)).toEqual(['pending.dat'])
  })

  it('keeps a limited number', async () => {
    const folder = await tempFolder()
    for (let index = 0; index < MAX_PENDING_LABELS; index++) await addPending(folder, input, deps())
    expect(await addPending(folder, input, deps())).toEqual({ ok: false, message: expect.stringContaining(String(MAX_PENDING_LABELS)) })
  })
})
