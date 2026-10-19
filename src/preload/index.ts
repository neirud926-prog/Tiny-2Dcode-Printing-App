import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PreloadApi } from './api'

const api: PreloadApi = {
  getStartup: () => ipcRenderer.invoke(IPC_CHANNELS.getStartup),
  importItemList: () => ipcRenderer.invoke(IPC_CHANNELS.importItemList),
  lookupItem: (itemCode) => ipcRenderer.invoke(IPC_CHANNELS.lookupItem, itemCode),
  importStockOnhand: () => ipcRenderer.invoke(IPC_CHANNELS.importStockOnhand),
  getStockLots: (itemCode) => ipcRenderer.invoke(IPC_CHANNELS.getStockLots, itemCode),
  listPrinters: () => ipcRenderer.invoke(IPC_CHANNELS.listPrinters),
  chooseLogFolder: () => ipcRenderer.invoke(IPC_CHANNELS.chooseLogFolder),
  testPrint: (settings) => ipcRenderer.invoke(IPC_CHANNELS.testPrint, settings),
  savePrinterSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.savePrinterSettings, settings),
  printLabel: (request) => ipcRenderer.invoke(IPC_CHANNELS.printLabel, request),
  savePendingLabel: (request) => ipcRenderer.invoke(IPC_CHANNELS.savePendingLabel, request),
  listPendingLabels: () => ipcRenderer.invoke(IPC_CHANNELS.listPendingLabels),
  printPendingLabel: (id, packVolumeDigit) => ipcRenderer.invoke(IPC_CHANNELS.printPendingLabel, { id, packVolumeDigit }),
  deletePendingLabel: (id) => ipcRenderer.invoke(IPC_CHANNELS.deletePendingLabel, id)
}

contextBridge.exposeInMainWorld('api', api)
