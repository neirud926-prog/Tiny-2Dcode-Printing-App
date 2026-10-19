import { describe, expect, it } from 'vitest'
import { indexItems } from './itemList'
import { pendingCounts, readyAnnouncement, viewPendingLabels, type PendingLabel, type PendingLabelView } from './pendingLabel'

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

const index = indexItems([{ itemCode: 'PARA01', name: 'SYNTHETIC FICTAMOL TABLET 500MG', baseUnit: 'TAB' }])

function pending(itemCode: string, expiry: string): PendingLabel {
  return { id: itemCode + expiry, itemCode, packVolumeDigit: null, expiry, lot: 'L1', copies: 1, savedBy: 'chantm', pc: 'PHARM-01', savedAt: '2026-10-01T09:00:00.000Z' }
}

describe('viewPendingLabels status', () => {
  const today = '2026-10-19'

  it('is expired when the Expiry is before today, whether or not the Item Code is listed', () => {
    const views = viewPendingLabels([pending('PARA01', '18102026'), pending('NEW001', '31122025')], index, today)
    expect(views.map((view) => view.status)).toEqual(['expired', 'expired'])
  })

  it('is not expired on the day of the Expiry itself, nor after it', () => {
    const views = viewPendingLabels([pending('PARA01', '19102026'), pending('NEW001', '20102026')], index, today)
    expect(views.map((view) => view.status)).toEqual(['ready', 'waiting'])
  })

  it('compares the whole date, not just the year or month', () => {
    const views = viewPendingLabels([pending('NEW001', '01112026'), pending('NEW002', '30092026'), pending('NEW003', '31122027')], null, today)
    expect(views.map((view) => view.status)).toEqual(['waiting', 'expired', 'waiting'])
  })
})
