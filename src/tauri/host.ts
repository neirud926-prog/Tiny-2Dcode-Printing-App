/** The host in the Tauri app: Rust commands for who and where this PC is, the dialog and printing. */
import { invoke } from '@tauri-apps/api/core'
import type { AppHost } from '../app/host'
import { pcNameFromHostname } from '../data/pcSettings'
import type { PrinterChoice } from '../preload/api'
import { htmlDataUrl } from '../render/printJob'

/** `startup_info` in `src-tauri/src/main.rs`. */
interface StartupInfo {
  readonly dataFolder: string
  readonly hostname: string
  readonly windowsUser: string
}

export async function createTauriHost(): Promise<AppHost> {
  const info = await invoke<StartupInfo>('startup_info')
  return {
    dataFolder: info.dataFolder,
    pcName: pcNameFromHostname(info.hostname),
    windowsUser: info.windowsUser,
    chooseFile: (options) => invoke<string | null>('choose_file', { options }),
    listPrinters: () => invoke<PrinterChoice[]>('list_printers'),
    async sendToPrinter(job) {
      try {
        // Rust loads the page as this data: URL, encoded once, here, as for the Electron app.
        await invoke('print_label', { job: { ...job, url: htmlDataUrl(job.html) } })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: String(error) }
      }
    }
  }
}
