import { describe, expect, it } from 'vitest'
import { pendingCounts, readyAnnouncement, type PendingLabelView } from './pendingLabel'

function view(id: string, status: 'waiting' | 'ready'): PendingLabelView {
  const base = { id, itemCode: 'PARA01', packVolumeDigit: null, expiry: '31122027', lot: 'L1', copies: 1, savedBy: 'chantm', pc: 'PHARM-01', savedAt: '2026-10-19T09:00:00.000Z' }
  return status === 'ready' ? { ...base, status, itemName: 'Paracetamol', liquid: false } : { ...base, status }
}

describe('readyAnnouncement', () => {
  it('announces nothing on the first check, even when labels are ready', () => {
    const { announce, ready } = readyAnnouncement(null, [view('a', 'ready'), view('b', 'waiting')])
    expect(announce).toBe(false)
    expect([...ready]).toEqual(['a'])
  })

  it('announces a label that was waiting and is now ready', () => {
    const first = readyAnnouncement(null, [view('a', 'waiting')])
    const second = readyAnnouncement(first.ready, [view('a', 'ready')])
    expect(second.announce).toBe(true)
    expect([...second.ready]).toEqual(['a'])
  })

  it('does not announce a label that was already ready', () => {
    const first = readyAnnouncement(null, [view('a', 'ready')])
    expect(readyAnnouncement(first.ready, [view('a', 'ready')]).announce).toBe(false)
  })
})

describe('pendingCounts', () => {
  it('counts the ready and all Pending Labels', () => {
    expect(pendingCounts([view('a', 'ready'), view('b', 'waiting'), view('c', 'ready')])).toEqual({ ready: 2, total: 3 })
    expect(pendingCounts([])).toEqual({ ready: 0, total: 0 })
  })
})
