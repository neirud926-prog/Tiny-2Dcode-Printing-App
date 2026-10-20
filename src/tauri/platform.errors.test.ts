import { describe, expect, it, vi } from 'vitest'
import { errorCode } from '../data/atomicWrite'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
const { tauriPlatform } = await import('./platform')

// The data layer acts on these codes (ENOENT: missing, EEXIST: lock held / log exists), so a Rust
// failure must reach it as an Error carrying the same code.
describe('Tauri platform errors', () => {
  it.each(['ENOENT', 'EEXIST', 'EBUSY', 'EACCES'])('keep the code %s', async (code) => {
    invoke.mockRejectedValueOnce({ code, message: `${code}: from Rust` })
    const error = await tauriPlatform.fs.createFile('C:\\LabelData\\pending.lock', new Uint8Array()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(errorCode(error)).toBe(code)
    expect((error as Error).message).toBe(`${code}: from Rust`)
  })

  it('passes the command its path and bytes', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await tauriPlatform.fs.appendFile('C:\\logs\\x.csv', new Uint8Array([1, 2]))
    expect(invoke).toHaveBeenLastCalledWith('append_file', { path: 'C:\\logs\\x.csv', data: [1, 2] })
  })
})
