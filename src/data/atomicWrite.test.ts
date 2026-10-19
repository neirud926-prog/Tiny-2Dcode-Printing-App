import { open, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAtomicWriteDeps, RENAME_RETRY_DELAYS_MS, writeFileAtomic, type AtomicWriteDeps } from './atomicWrite'
import { tempFolder } from './testFolder'

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code })
}

/** Real file operations, no waiting between retries, and a record of what happened. */
function recordingDeps(overrides: Partial<AtomicWriteDeps> = {}) {
  const sleeps: number[] = []
  const renames: string[] = []
  const deps: AtomicWriteDeps = {
    ...defaultAtomicWriteDeps,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...overrides
  }
  const rename = deps.rename
  deps.rename = async (from, to) => {
    renames.push(from)
    await rename(from, to)
  }
  return { deps, sleeps, renames }
}

describe('writeFileAtomic', () => {
  it('writes a temp file beside the target, then renames it over the target', async () => {
    const folder = await tempFolder()
    const target = join(folder, 'items.dat')
    await writeFile(target, 'old')
    const { deps, renames } = recordingDeps()
    await writeFileAtomic(target, Buffer.from('new'), deps)
    expect(await readFile(target, 'utf8')).toBe('new')
    expect(renames).toHaveLength(1)
    expect(renames[0]).toMatch(new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.tmp-${process.pid}-[0-9a-f]+$`))
    expect(await readdir(folder)).toEqual(['items.dat'])
  })

  it('leaves the old file intact and no temp file when writing fails part-way', async () => {
    const folder = await tempFolder()
    const target = join(folder, 'items.dat')
    await writeFile(target, 'old content')
    const { deps } = recordingDeps({
      writeTempFile: async (path, data) => {
        // Half the data reaches the disk, then the disk fills up.
        const handle = await open(path, 'wx')
        await handle.write(data.subarray(0, data.length / 2))
        await handle.close()
        throw fsError('ENOSPC')
      }
    })
    await expect(writeFileAtomic(target, Buffer.from('new content that never lands'), deps)).rejects.toThrow(/items\.dat.*ENOSPC/)
    expect(await readFile(target, 'utf8')).toBe('old content')
    expect(await readdir(folder)).toEqual(['items.dat'])
  })

  it('retries the rename while Windows holds the target locked', async () => {
    const folder = await tempFolder()
    const target = join(folder, 'items.dat')
    await writeFile(target, 'old')
    const failures = ['EBUSY', 'EPERM', 'EACCES']
    const { deps, sleeps } = recordingDeps({
      rename: async (from, to) => {
        const code = failures.shift()
        if (code) throw fsError(code)
        await defaultAtomicWriteDeps.rename(from, to)
      }
    })
    await writeFileAtomic(target, Buffer.from('new'), deps)
    expect(await readFile(target, 'utf8')).toBe('new')
    expect(sleeps).toEqual(RENAME_RETRY_DELAYS_MS.slice(0, 3))
    expect(await readdir(folder)).toEqual(['items.dat'])
  })

  it('gives up after its retries, keeping the old file and removing the temp file', async () => {
    const folder = await tempFolder()
    const target = join(folder, 'items.dat')
    await writeFile(target, 'old')
    const { deps, sleeps } = recordingDeps({
      rename: async () => {
        throw fsError('EBUSY')
      }
    })
    await expect(writeFileAtomic(target, Buffer.from('new'), deps)).rejects.toThrow(/Could not save .*items\.dat.*EBUSY/)
    expect(sleeps).toEqual(RENAME_RETRY_DELAYS_MS)
    expect(await readFile(target, 'utf8')).toBe('old')
    expect(await readdir(folder)).toEqual(['items.dat'])
  })

  it('does not retry an error that is not a file lock', async () => {
    const folder = await tempFolder()
    const target = join(folder, 'items.dat')
    const { deps, sleeps } = recordingDeps({
      rename: async () => {
        throw fsError('ENOENT')
      }
    })
    await expect(writeFileAtomic(target, Buffer.from('new'), deps)).rejects.toThrow(/ENOENT/)
    expect(sleeps).toEqual([])
    expect(await readdir(folder)).toEqual([])
  })
})
