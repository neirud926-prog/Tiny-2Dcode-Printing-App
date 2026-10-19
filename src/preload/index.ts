import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PreloadApi } from './api'

const api: PreloadApi = {
  getStartup: () => ipcRenderer.invoke(IPC_CHANNELS.getStartup),
  listPrinters: () => ipcRenderer.invoke(IPC_CHANNELS.listPrinters),
  chooseLogFolder: () => ipcRenderer.invoke(IPC_CHANNELS.chooseLogFolder),
  testPrint: (settings) => ipcRenderer.invoke(IPC_CHANNELS.testPrint, settings),
  savePrinterSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.savePrinterSettings, settings),
  printLabel: (request) => ipcRenderer.invoke(IPC_CHANNELS.printLabel, request)
}

contextBridge.exposeInMainWorld('api', api)
