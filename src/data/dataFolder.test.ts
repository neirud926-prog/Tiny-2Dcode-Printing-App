import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDataFolder, checkFolderWritable } from './dataFolder'
import { tempFolder } from './testFolder'

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
