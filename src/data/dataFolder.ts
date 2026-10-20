/**
 * The data folder `LabelData` next to the portable `.exe`, shared by every PC that runs the app from
 * the same drive. The Rust shell resolves it (`src-tauri/src/main.rs`); the app checks it can write there
 * before anything else.
 */

import { errorText } from './atomicWrite'
import { platform, randomHex } from './platform'

export type FolderCheckResult = { ok: true } | { ok: false; reason: string }

/** Creates the folder if missing, then writes and deletes a probe file in it. */
export async function checkFolderWritable(folder: string): Promise<FolderCheckResult> {
  const { fs, path } = platform()
  const probe = path.join(folder, `.write-check-${randomHex(6)}`)
  try {
    await fs.mkdir(folder)
    await fs.createFile(probe, new TextEncoder().encode('write check'))
    await fs.unlink(probe)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  }
}

export type DataFolderCheckResult = { ok: true } | { ok: false; message: string; reason: string }

/** The startup check: can the app write to its data folder? */
export async function checkDataFolder(folder: string): Promise<DataFolderCheckResult> {
  const result = await checkFolderWritable(folder)
  if (result.ok) return result
  return { ok: false, message: `The app cannot write to its folder ${folder}. Copy it to a folder you can write to.`, reason: result.reason }
}
