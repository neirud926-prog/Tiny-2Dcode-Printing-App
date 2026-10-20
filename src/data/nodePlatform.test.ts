import { readdir, readFile, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { errorCode } from './atomicWrite'
import { nodePlatform } from './nodePlatform'
import { tempFolder } from './testFolder'

const { fs } = nodePlatform
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

// The contract every platform keeps (the Tauri one in Rust too): the data layer relies on these codes.
describe('the Node platform', () => {
  it('reports a missing file as ENOENT', async () => {
    const folder = await tempFolder()
    for (const call of [() => fs.readFile(join(folder, 'none')), () => fs.stat(join(folder, 'none')), () => fs.unlink(join(folder, 'none'))]) {
      expect(errorCode(await call().catch((error: unknown) => error))).toBe('ENOENT')
    }
  })

  it('creates a file only if it does not exist (EEXIST otherwise)', async () => {
    const path = join(await tempFolder(), 'lock')
    await fs.createFile(path, bytes('one'))
    expect(errorCode(await fs.createFile(path, bytes('two')).catch((error: unknown) => error))).toBe('EEXIST')
    expect(await readFile(path, 'utf8')).toBe('one')
  })

  it('appends, creating the file if needed', async () => {
    const path = join(await tempFolder(), 'log.csv')
    await fs.appendFile(path, bytes('a'))
    await fs.appendFile(path, bytes('b'))
    expect(await readFile(path, 'utf8')).toBe('ab')
  })

  it('renames over an existing file', async () => {
    const folder = await tempFolder()
    await writeFile(join(folder, 'new'), 'new')
    await writeFile(join(folder, 'old'), 'old')
    await fs.rename(join(folder, 'new'), join(folder, 'old'))
    expect(await readdir(folder)).toEqual(['old'])
    expect(await readFile(join(folder, 'old'), 'utf8')).toBe('new')
  })

  it('makes nested folders, and an existing folder is fine', async () => {
    const folder = join(await tempFolder(), 'a', 'b')
    await fs.mkdir(folder)
    await fs.mkdir(folder)
    expect(statSync(folder).isDirectory()).toBe(true)
  })

  it('reads bytes and stats size and modified time', async () => {
    const path = join(await tempFolder(), 'f')
    await writeFile(path, 'hello')
    expect(new TextDecoder().decode(await fs.readFile(path))).toBe('hello')
    const stats = await fs.stat(path)
    expect(stats.size).toBe(5)
    expect(stats.mtimeMs).toBe(statSync(path).mtimeMs)
  })
})

describe('the shared app logic', () => {
  /** Modules the Tauri webview runs: they may not use Node or Electron. */
  const shared = ['src/core', 'src/render', 'src/data', 'src/app'].flatMap((folder) =>
    readdirSync(folder)
      .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts') && !['nodePlatform.ts', 'testFolder.ts', 'testSetup.ts'].includes(file))
      .map((file) => join(folder, file))
  )

  it('imports no Node module and not Electron', () => {
    expect(shared.length).toBeGreaterThan(20)
    for (const file of shared) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from '(node:[^']+|electron)'/)
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(Buffer|process)\./)
    }
  })
})
