import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

/** A fresh temporary folder for one test, removed after it. Call inside a test. */
export async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'tdcp-test-'))
  created.push(folder)
  return folder
}

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
