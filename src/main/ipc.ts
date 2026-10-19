import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { errorText } from '../data/atomicWrite'
import { checkDataFolder, checkFolderWritable } from '../data/dataFolder'
import { createItemListSource } from '../data/itemListStore'
import { defaultLogFolder, loadPcSettings, resolveLogFolder, savePcSettings } from '../data/pcSettings'
import { appendPrintLog } from '../data/printLog'
import { createStockOnhandSource } from '../data/stockOnhandStore'
import {
  IPC_CHANNELS,
  type AppStartup,
  type ImportItemListOutcome,
  type ImportStockOnhandOutcome,
  type ItemLookup,
  type PreloadApi,
  type PrinterChoice,
  type PrintOutcome,
  type SaveSettingsOutcome,
  type StockLotsLookup
} from '../preload/api'
import { normalisePcSettings, type PcSettings } from '../render/printSettings'
import { itemLookupFor, stockLotsLookupFor } from './itemLookup'
import { printerProblem, printLabelRequest, printTestLabel, type PrintContext, type PrintServiceDeps } from './printService'
import { sendToPrinter } from './printWindow'

export interface IpcContext extends PrintContext {
  /** The app window, the only renderer allowed to call the API. */
  getMainWindow(): BrowserWindow | null
}

/**
 * Handles the preload API. Everything the renderer sends is validated here; the renderer can name
 * a log folder, an Item List file or a Stock Onhand report only by choosing it in the system dialog
 * (or the default), and never sends markup.
 */
export function registerIpc(context: IpcContext): void {
  const { dataFolder, pcName } = context
  const deps: PrintServiceDeps = { now: () => new Date(), sendToPrinter, appendLog: appendPrintLog }
  const itemLists = createItemListSource(dataFolder)
  const stockOnhand = createStockOnhandSource(dataFolder)

  /** True once the data folder passed its write check. */
  let folderReady = false
  let settings: PcSettings | null = null
  /** Log folders the renderer may save: the current one and any chosen in the dialog. */
  const allowedLogFolders = new Set<string>()
  let printing = false

  const handlers: { [K in keyof PreloadApi]: (event: IpcMainInvokeEvent, arg: unknown) => ReturnType<PreloadApi[K]> } = {
    getStartup,
    importItemList,
    lookupItem,
    importStockOnhand,
    getStockLots,
    listPrinters: (event) => installedPrinters(event),
    chooseLogFolder,
    testPrint,
    savePrinterSettings,
    printLabel: (_event, request) =>
      exclusively(async () => {
        const itemList = folderReady ? await itemLists.current() : null
        return printLabelRequest(request, folderReady ? settings : null, itemList?.index ?? null, context, deps)
      })
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
    const items = await itemLists.load()
    const stock = await stockOnhand.load()
    return {
      status: 'ready',
      pcName,
      dataFolder,
      defaultLogFolder: defaultLogFolder(dataFolder),
      settings,
      settingsNotice: loaded.status === 'tampered' || loaded.status === 'unreadable' ? `${loaded.message} Set up the printer again.` : null,
      itemList: items.status === 'ok' ? items.list.info : null,
      itemListNotice: items.status === 'tampered' || items.status === 'unreadable' ? `${items.message} Import the Item List again.` : null,
      stockOnhand: stock.status === 'ok' ? stock.stock.info : null,
      stockOnhandNotice: stock.status === 'tampered' || stock.status === 'unreadable' ? `${stock.message} Import today's Stock Onhand again.` : null
    }
  }

  async function importItemList(event: IpcMainInvokeEvent): Promise<ImportItemListOutcome> {
    if (!folderReady) return { status: 'refused', message: 'The data folder is not ready.', summary: null, badRows: [], warning: null }
    const options: OpenDialogOptions = {
      title: 'Import the Item List (item_phq.txt)',
      properties: ['openFile'],
      filters: [
        { name: 'Item List (*.txt)', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const file = await chooseFile(event, options)
    if (!file) return { status: 'cancelled' }
    return itemLists.importFile(file, { logFolder: currentLogFolder(), pcName, windowsUser: context.windowsUser, now: () => new Date() })
  }

  async function lookupItem(_event: IpcMainInvokeEvent, itemCode: unknown): Promise<ItemLookup> {
    return itemLookupFor(folderReady ? await itemLists.current() : null, itemCode)
  }

  async function importStockOnhand(event: IpcMainInvokeEvent): Promise<ImportStockOnhandOutcome> {
    if (!folderReady) return { status: 'refused', message: 'The data folder is not ready.', summary: null, badRows: [], warning: null }
    const file = await chooseFile(event, {
      title: "Import today's Stock Onhand (HA: INV Stock onhand with lot details)",
      properties: ['openFile'],
      filters: [
        { name: 'Stock Onhand report (*.ps, *.txt, *.csv)', extensions: ['ps', 'txt', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (!file) return { status: 'cancelled' }
    const itemList = await itemLists.current()
    return stockOnhand.importFile(file, {
      logFolder: currentLogFolder(),
      pcName,
      windowsUser: context.windowsUser,
      now: () => new Date(),
      itemIndex: itemList?.index ?? null
    })
  }

  async function getStockLots(_event: IpcMainInvokeEvent, itemCode: unknown): Promise<StockLotsLookup> {
    return stockLotsLookupFor(folderReady ? await stockOnhand.current() : null, itemCode)
  }

  async function chooseLogFolder(event: IpcMainInvokeEvent): Promise<string | null> {
    const options: OpenDialogOptions = {
      title: 'Choose the log folder',
      defaultPath: currentLogFolder(),
      properties: ['openDirectory', 'createDirectory']
    }
    const folder = await chooseFile(event, options)
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

  /** Shows the system open dialog over the window that asked; the chosen path, or null if cancelled. */
  async function chooseFile(event: IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string | null> {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const chosen = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return (!chosen.canceled && chosen.filePaths[0]) || null
  }

  /** Where this PC's logs go: the folder in its settings, else `logs` in the data folder. */
  function currentLogFolder(): string {
    return settings ? resolveLogFolder(dataFolder, settings) : defaultLogFolder(dataFolder)
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
