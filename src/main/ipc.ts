import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import type { AppHost, FileDialogOptions } from '../app/host'
import { createAppService } from '../app/service'
import { IPC_CHANNELS, type PreloadApi, type PrinterChoice } from '../preload/api'
import { sendToPrinter } from './printWindow'

export interface IpcContext extends Pick<AppHost, 'dataFolder' | 'pcName' | 'windowsUser'> {
  /** The app window, the only renderer allowed to call the API. */
  getMainWindow(): BrowserWindow | null
}

/** Serves the app (`createAppService`) to the app window over IPC, with Electron's dialogs and printing. */
export function registerIpc(context: IpcContext): void {
  const api = createAppService({
    dataFolder: context.dataFolder,
    pcName: context.pcName,
    windowsUser: context.windowsUser,
    chooseFile,
    listPrinters,
    sendToPrinter
  })

  // The renderer's arguments, as the preload sends them; the service checks them as untrusted.
  const handlers: { [K in keyof PreloadApi]: (arg: unknown) => ReturnType<PreloadApi[K]> } = {
    getStartup: () => api.getStartup(),
    importItemList: () => api.importItemList(),
    lookupItem: (itemCode) => api.lookupItem(itemCode as string),
    importStockOnhand: () => api.importStockOnhand(),
    getStockLots: (itemCode) => api.getStockLots(itemCode as string),
    listPrinters: () => api.listPrinters(),
    chooseLogFolder: () => api.chooseLogFolder(),
    testPrint: (settings) => api.testPrint(settings as never),
    savePrinterSettings: (settings) => api.savePrinterSettings(settings as never),
    printLabel: (request) => api.printLabel(request as never),
    savePendingLabel: (request) => api.savePendingLabel(request as never),
    listPendingLabels: () => api.listPendingLabels(),
    printPendingLabel: (arg) => {
      const { id, packVolumeDigit } = (typeof arg === 'object' && arg !== null ? arg : {}) as { id?: unknown; packVolumeDigit?: unknown }
      return api.printPendingLabel(id as string, packVolumeDigit as number | null)
    },
    deletePendingLabel: (id) => api.deletePendingLabel(id as string),
    deleteExpiredPendingLabels: () => api.deleteExpiredPendingLabels()
  }

  for (const method of Object.keys(handlers) as (keyof PreloadApi)[]) {
    ipcMain.handle(IPC_CHANNELS[method], (event, arg: unknown) => {
      // Only the app window may call the API.
      const mainWindow = context.getMainWindow()
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
        throw new Error(`Refused ${IPC_CHANNELS[method]} from an unknown page.`)
      }
      return handlers[method](arg)
    })
  }

  /** Shows the system open dialog over the app window; the chosen path, or null if cancelled. */
  async function chooseFile(options: FileDialogOptions): Promise<string | null> {
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters?.map((filter) => ({ name: filter.name, extensions: [...filter.extensions] })),
      properties: options.kind === 'folder' ? ['openDirectory', 'createDirectory'] : ['openFile']
    }
    const owner = context.getMainWindow()
    const chosen = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return (!chosen.canceled && chosen.filePaths[0]) || null
  }

  async function listPrinters(): Promise<PrinterChoice[]> {
    const window = context.getMainWindow()
    if (!window) return []
    const printers = await window.webContents.getPrintersAsync()
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName || printer.name }))
  }
}
