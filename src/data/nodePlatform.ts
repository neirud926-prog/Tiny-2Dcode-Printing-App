/** The platform on Node: the Electron main process and the tests. */
import { appendFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Platform } from './platform'

export const nodePlatform: Platform = {
  fs: {
    readFile: async (file) => new Uint8Array(await readFile(file)),
    async createFile(file, data) {
      const handle = await open(file, 'wx')
      try {
        await handle.writeFile(data)
        await handle.sync()
      } finally {
        await handle.close()
      }
    },
    appendFile: (file, data) => appendFile(file, data),
    rename,
    unlink,
    mkdir: async (folder) => {
      await mkdir(folder, { recursive: true })
    },
    async stat(file) {
      const stats = await stat(file)
      return { size: stats.size, mtimeMs: stats.mtimeMs }
    }
  },
  path: { join: path.join, dirname: path.dirname, basename: path.basename }
}
