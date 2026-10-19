/**
 * The data folder `LabelData` next to the portable `.exe`, shared by every PC that runs the app from
 * the same drive. The main process resolves it once and checks it can write there before anything else.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorText } from './atomicWrite'

export const DATA_FOLDER_NAME = 'LabelData'

/** Where the app is running from. */
export interface AppLocation {
  /** Set by electron-builder's portable launcher: the folder holding the `.exe` staff double-clicked. */
  readonly portableExecutableDir?: string
  readonly isPackaged: boolean
  /** The running executable (for a portable app, its unpacked copy in a temp folder). */
  readonly exePath: string
  /** The app's own folder (in development, the project folder). */
  readonly appPath: string
}

type PathApi = Pick<typeof path, 'join' | 'dirname'>

/**
 * `LabelData` beside the portable `.exe`; beside the executable for an unpacked build; in the
 * project folder during development (git-ignored). `pathApi` lets tests use Windows paths.
 */
export function resolveDataFolder(location: AppLocation, pathApi: PathApi = path): string {
  if (location.portableExecutableDir) return pathApi.join(location.portableExecutableDir, DATA_FOLDER_NAME)
  if (location.isPackaged) return pathApi.join(pathApi.dirname(location.exePath), DATA_FOLDER_NAME)
  return pathApi.join(location.appPath, DATA_FOLDER_NAME)
}

export type FolderCheckResult = { ok: true } | { ok: false; reason: string }

/** Creates the folder if missing, then writes and deletes a probe file in it. */
export async function checkFolderWritable(folder: string): Promise<FolderCheckResult> {
  const probe = path.join(folder, `.write-check-${process.pid}-${randomBytes(4).toString('hex')}`)
  try {
    await mkdir(folder, { recursive: true })
    await writeFile(probe, 'write check', { flag: 'wx' })
    await unlink(probe)
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
