import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { basename, dirname, join } from './platform'

// The Tauri paths must match what Node's Windows paths give the Electron app.
describe('Tauri platform paths', () => {
  const joins: string[][] = [
    ['S:\\Pharmacy\\Label App\\LabelData', 'pcs', 'PHARM-01.dat'],
    ['S:\\LabelData\\', 'logs'],
    ['C:/Users/amy', 'LabelData'],
    ['\\\\files\\pharm\\LabelData', 'items.dat'],
    ['C:\\', 'x']
  ]
  it.each(joins)('joins like path.win32 (%s)', (...parts) => {
    expect(join(...parts)).toBe(win32.join(...parts))
  })

  const paths = ['S:\\LabelData\\pcs\\PHARM-01.dat', 'C:\\items.dat', 'C:/Users/amy/item_phq.txt', '\\\\files\\pharm\\LabelData\\items.dat', 'items.dat']
  it.each(paths)('dirname and basename like path.win32 (%s)', (path) => {
    expect(dirname(path)).toBe(win32.dirname(path))
    expect(basename(path)).toBe(win32.basename(path))
  })
})
