import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOT_MM } from '../render/dataMatrix'
import type { PcSettings } from '../render/printSettings'
import { defaultLogFolder, loadPcSettings, pcNameFromHostname, pcSettingsPath, resolveLogFolder, savePcSettings } from './pcSettings'
import { writeSealed } from './sealed'
import { tempFolder } from './testFolder'

const settings: PcSettings = {
  printerName: 'ZDesigner GX420t',
  labelSize: { widthMm: 34.4, heightMm: 25 },
  offsetXmm: 2 * DOT_MM,
  offsetYmm: 0,
  logFolder: null
}

describe('pcNameFromHostname', () => {
  it('upper-cases the host name and drops any domain', () => {
    expect(pcNameFromHostname('pharm-01')).toBe('PHARM-01')
    expect(pcNameFromHostname('PHARM-01.nlth.ha.org.hk')).toBe('PHARM-01')
  })

  it('replaces characters a file name cannot safely hold', () => {
    expect(pcNameFromHostname('My PC:2/3')).toBe('MY_PC_2_3')
    expect(pcNameFromHostname('..')).toBe('UNKNOWN-PC')
    expect(pcNameFromHostname('')).toBe('UNKNOWN-PC')
  })
})

describe('per-PC settings', () => {
  it('live in pcs/<PC name>.dat under the data folder', () => {
    expect(pcSettingsPath('/share/LabelData', 'PHARM-01')).toBe(join('/share/LabelData', 'pcs', 'PHARM-01.dat'))
  })

  it('are missing on a PC that has not been set up', async () => {
    expect(await loadPcSettings(await tempFolder(), 'PHARM-01')).toEqual({ status: 'missing' })
  })

  it('round-trip, sealed, per PC', async () => {
    const root = await tempFolder()
    await savePcSettings(root, 'PHARM-01', settings)
    expect(await loadPcSettings(root, 'PHARM-01')).toEqual({ status: 'ok', settings })
    expect(await loadPcSettings(root, 'PHARM-02')).toEqual({ status: 'missing' })
    expect((await readFile(pcSettingsPath(root, 'PHARM-01'))).subarray(0, 4).toString('latin1')).toBe('TDCP')
  })

  it('snap offsets to whole printer dots when saved', async () => {
    const root = await tempFolder()
    await savePcSettings(root, 'PHARM-01', { ...settings, offsetXmm: 0.3, offsetYmm: -0.2 })
    const loaded = await loadPcSettings(root, 'PHARM-01')
    if (loaded.status !== 'ok') throw new Error(loaded.status)
    expect(loaded.settings.offsetXmm / DOT_MM).toBeCloseTo(2, 9)
    expect(loaded.settings.offsetYmm / DOT_MM).toBeCloseTo(-2, 9)
  })

  it('refuse settings that are not valid', async () => {
    await expect(savePcSettings(await tempFolder(), 'PHARM-01', { ...settings, printerName: '' })).rejects.toThrow(/printer/i)
  })

  it('are refused when changed outside the app', async () => {
    const root = await tempFolder()
    await savePcSettings(root, 'PHARM-01', settings)
    const path = pcSettingsPath(root, 'PHARM-01')
    const bytes = await readFile(path)
    bytes[bytes.length - 1] ^= 0xff
    await writeFile(path, bytes)
    expect(await loadPcSettings(root, 'PHARM-01')).toEqual({
      status: 'tampered',
      message: "This PC's printer settings (PHARM-01.dat) were changed outside the app."
    })
  })

  it('are unreadable when a sealed file holds something else', async () => {
    const root = await tempFolder()
    await writeSealed(pcSettingsPath(root, 'PHARM-01'), { items: [] })
    const loaded = await loadPcSettings(root, 'PHARM-01')
    expect(loaded.status).toBe('unreadable')
  })
})

describe('log folder', () => {
  it('defaults to logs/ in the data folder', () => {
    expect(defaultLogFolder('/share/LabelData')).toBe(join('/share/LabelData', 'logs'))
    expect(resolveLogFolder('/share/LabelData', settings)).toBe(join('/share/LabelData', 'logs'))
  })

  it('uses the chosen folder when set', () => {
    expect(resolveLogFolder('/share/LabelData', { ...settings, logFolder: '/share/Supervisor/logs' })).toBe('/share/Supervisor/logs')
  })
})
