import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { errorText } from '../data/atomicWrite'
import { checkDataFolder, checkFolderWritable } from '../data/dataFolder'
import { defaultLogFolder, loadPcSettings, resolveLogFolder, savePcSettings } from '../data/pcSettings'
import { appendPrintLog } from '../data/printLog'
import { IPC_CHANNELS, type AppStartup, type PreloadApi, type PrinterChoice, type PrintOutcome, type SaveSettingsOutcome } from '../preload/api'
import { normalisePcSettings, type PcSettings } from '../render/printSettings'
import { printerProblem, printLabelRequest, printTestLabel, type PrintContext, type PrintServiceDeps } from './printService'
import { sendToPrinter } from './printWindow'

export interface IpcContext extends PrintContext {
  /** The app window, the only renderer allowed to call the API. */
  getMainWindow(): BrowserWindow | null
}

/**
 * Handles the preload API. Everything the renderer sends is validated here; the renderer can name
 * a log folder only by choosing it in the system dialog (or the default), and never sends markup.
 */
export function registerIpc(context: IpcContext): void {
  const { dataFolder, pcName } = context
  const deps: PrintServiceDeps = { now: () => new Date(), sendToPrinter, appendLog: appendPrintLog }

  /** True once the data folder passed its write check. */
  let folderReady = false
  let settings: PcSettings | null = null
  /** Log folders the renderer may save: the current one and any chosen in the dialog. */
  const allowedLogFolders = new Set<string>()
  let printing = false

  const handlers: { [K in keyof PreloadApi]: (event: IpcMainInvokeEvent, arg: unknown) => ReturnType<PreloadApi[K]> } = {
    getStartup,
    listPrinters: (event) => installedPrinters(event),
    chooseLogFolder,
    testPrint,
    savePrinterSettings,
    printLabel: (_event, request) => exclusively(() => printLabelRequest(request, folderReady ? settings : null, context, deps))
  }

  for (const method of Object.keys(handlers) as (keyof PreloadApi)[]) {
    ipcMain.handle(IPC_CHANNELS[method], (event, arg: unknown) => {
      // Only the app window may call the API.
      const mainWindow = context.getMainWindow()
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
        throw new Error(`Refused ${IPC_CHANNELS[method]} from an unknown page.`)
      }
      return handlers[method](event, arg)
    })
  }

  async function getStartup(): Promise<AppStartup> {
    const folder = await checkDataFolder(dataFolder)
    folderReady = folder.ok
    if (!folder.ok) return { status: 'folder-error', message: folder.message, reason: folder.reason }

    const loaded = await loadPcSettings(dataFolder, pcName)
    settings = loaded.status === 'ok' ? loaded.settings : null
    if (settings?.logFolder) allowedLogFolders.add(settings.logFolder)
    return {
      status: 'ready',
      pcName,
      dataFolder,
      defaultLogFolder: defaultLogFolder(dataFolder),
      settings,
      settingsNotice: loaded.status === 'tampered' || loaded.status === 'unreadable' ? `${loaded.message} Set up the printer again.` : null
    }
  }

  async function chooseLogFolder(event: IpcMainInvokeEvent): Promise<string | null> {
    const options: OpenDialogOptions = {
      title: 'Choose the log folder',
      defaultPath: settings ? resolveLogFolder(dataFolder, settings) : defaultLogFolder(dataFolder),
      properties: ['openDirectory', 'createDirectory']
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const folder = result.canceled ? undefined : result.filePaths[0]
    if (!folder) return null
    allowedLogFolders.add(folder)
    return folder
  }

  async function testPrint(event: IpcMainInvokeEvent, input: unknown): Promise<PrintOutcome> {
    const checked = await checkSettings(event, input)
    if (!checked.ok) return { ok: false, message: `Test print failed: ${checked.message}` }
    return exclusively(() => printTestLabel(checked.settings, deps))
  }

  async function savePrinterSettings(event: IpcMainInvokeEvent, input: unknown): Promise<SaveSettingsOutcome> {
    if (!folderReady) return { ok: false, message: 'The data folder is not ready.' }
    const checked = await checkSettings(event, input)
    if (!checked.ok) return checked
    const candidate = checked.settings
    if (candidate.logFolder !== null && !allowedLogFolders.has(candidate.logFolder)) {
      return { ok: false, message: 'Choose the log folder with the Change button.' }
    }
    const logFolder = resolveLogFolder(dataFolder, candidate)
    const writable = await checkFolderWritable(logFolder)
    if (!writable.ok) return { ok: false, message: `The app cannot write to the log folder ${logFolder}. Choose a folder you can write to.` }
    try {
      settings = await savePcSettings(dataFolder, pcName, candidate)
      return { ok: true, settings }
    } catch (error) {
      return { ok: false, message: `The settings could not be saved: ${errorText(error)}` }
    }
  }

  /** One print at a time: a second press while printing is refused, not queued. */
  async function exclusively(task: () => Promise<PrintOutcome>): Promise<PrintOutcome> {
    if (printing) return { ok: false, message: 'Not printed: the previous label is still printing.' }
    printing = true
    try {
      return await task()
    } finally {
      printing = false
    }
  }

  async function checkSettings(event: IpcMainInvokeEvent, input: unknown): Promise<{ ok: true; settings: PcSettings } | { ok: false; message: string }> {
    const normalised = normalisePcSettings(input)
    if (!normalised.ok) return { ok: false, message: normalised.errors.map((error) => error.message).join(' ') }
    const problem = printerProblem(normalised.settings.printerName, await installedPrinters(event))
    if (problem) return { ok: false, message: problem }
    return normalised
  }

  async function installedPrinters(event: IpcMainInvokeEvent): Promise<PrinterChoice[]> {
    const printers = await event.sender.getPrintersAsync()
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }))
  }
}
