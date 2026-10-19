import { BrowserWindow } from 'electron'
import { htmlDataUrl, type LabelPrintJob } from '../render/printJob'
import { errorText } from '../data/atomicWrite'
import type { DriverResult } from './printService'

/**
 * Prints a label page silently: loads it in a hidden window that runs no scripts and can go
 * nowhere, prints it with the job's options, then closes the window.
 */
export async function sendToPrinter(job: LabelPrintJob): Promise<DriverResult> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    await window.loadURL(htmlDataUrl(job.html))
    return await new Promise<DriverResult>((resolve) => {
      window.webContents.print({ ...job.options }, (success, failureReason) => resolve(success ? { ok: true } : { ok: false, reason: failureReason }))
    })
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  } finally {
    window.destroy()
  }
}
