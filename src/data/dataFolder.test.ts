import { readdir, stat, writeFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDataFolder, checkFolderWritable, DATA_FOLDER_NAME, resolveDataFolder } from './dataFolder'
import { tempFolder } from './testFolder'

describe('resolveDataFolder', () => {
  it('puts LabelData next to the portable .exe', () => {
    expect(DATA_FOLDER_NAME).toBe('LabelData')
    expect(
      resolveDataFolder(
        {
          portableExecutableDir: 'S:\\Pharmacy\\Label App',
          isPackaged: true,
          exePath: 'C:\\Users\\nurse\\AppData\\Local\\Temp\\2abc\\2D Code Print.exe',
          appPath: 'C:\\Users\\nurse\\AppData\\Local\\Temp\\2abc\\resources\\app.asar'
        },
        win32
      )
    ).toBe('S:\\Pharmacy\\Label App\\LabelData')
  })

  it('never uses the temp folder the portable .exe unpacks itself to', () => {
    // The portable launcher unpacks the app to %TEMP% at each launch and sets PORTABLE_EXECUTABLE_DIR
    // to the folder holding the .exe staff double-clicked (with or without a trailing backslash).
    const unpacked = 'C:\\Users\\nurse\\AppData\\Local\\Temp\\2xYz9'
    for (const portableExecutableDir of ['S:\\Pharmacy\\Label App', 'S:\\Pharmacy\\Label App\\']) {
      const folder = resolveDataFolder(
        { portableExecutableDir, isPackaged: true, exePath: `${unpacked}\\2D Code Print.exe`, appPath: `${unpacked}\\resources\\app.asar` },
        win32
      )
      expect(folder).toBe('S:\\Pharmacy\\Label App\\LabelData')
      expect(folder.startsWith(unpacked)).toBe(false)
    }
  })

  it('works from a UNC share', () => {
    expect(
      resolveDataFolder({ portableExecutableDir: '\\\\nlth-fs01\\pharmacy\\label-app', isPackaged: true, exePath: 'C:\\x\\app.exe', appPath: 'C:\\x' }, win32)
    ).toBe('\\\\nlth-fs01\\pharmacy\\label-app\\LabelData')
  })

  it('falls back to the folder of the .exe when packaged but not portable', () => {
    expect(resolveDataFolder({ isPackaged: true, exePath: 'D:\\apps\\label\\app.exe', appPath: 'D:\\apps\\label\\resources\\app.asar' }, win32)).toBe(
      'D:\\apps\\label\\LabelData'
    )
  })

  it('uses a local folder in the project during development', () => {
    expect(resolveDataFolder({ isPackaged: false, exePath: '/repo/node_modules/electron/dist/Electron', appPath: '/repo' }, posix)).toBe('/repo/LabelData')
  })

  it('ignores an empty PORTABLE_EXECUTABLE_DIR', () => {
    expect(resolveDataFolder({ portableExecutableDir: '', isPackaged: false, exePath: '/e', appPath: '/repo' }, posix)).toBe('/repo/LabelData')
  })
})

describe('checkDataFolder', () => {
  it('creates the folder if missing and leaves no probe file behind', async () => {
    const folder = join(await tempFolder(), 'Label App', 'LabelData')
    expect(await checkDataFolder(folder)).toEqual({ ok: true })
    expect((await stat(folder)).isDirectory()).toBe(true)
    expect(await readdir(folder)).toEqual([])
  })

  it('explains what to do when the app cannot write to its folder', async () => {
    const parent = await tempFolder()
    // A file where a folder should be: nothing can be created beneath it.
    await writeFile(join(parent, 'blocked'), '')
    const folder = join(parent, 'blocked', 'LabelData')
    const result = await checkDataFolder(folder)
    expect(result).toEqual({
      ok: false,
      message: `The app cannot write to its folder ${folder}. Copy it to a folder you can write to.`,
      reason: expect.stringMatching(/ENOTDIR|EEXIST/)
    })
  })
})

describe('checkFolderWritable', () => {
  it('passes for a writable folder and fails beneath a file', async () => {
    const parent = await tempFolder()
    expect(await checkFolderWritable(parent)).toEqual({ ok: true })
    await writeFile(join(parent, 'file'), '')
    const result = await checkFolderWritable(join(parent, 'file', 'logs'))
    expect(result.ok).toBe(false)
  })
})
