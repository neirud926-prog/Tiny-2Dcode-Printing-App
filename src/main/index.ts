import { app, BrowserWindow } from 'electron'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { resolveDataFolder } from '../data/dataFolder'
import { nodePlatform } from '../data/nodePlatform'
import { setPlatform } from '../data/platform'
import { pcNameFromHostname } from '../data/pcSettings'
import { registerIpc } from './ipc'

// The data layer runs on Node in the Electron main process.
setPlatform(nodePlatform)

let mainWindow: BrowserWindow | null = null

function createMainWindow(): void {
  const window = new BrowserWindow({
    // Wide enough for the form beside a 4× label preview.
    width: 1000,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.once('ready-to-show', () => window.show())

  // The app never shows remote content: refuse pop-ups and navigation away from the app page.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  // In development electron-vite serves the renderer with hot reload; otherwise load the built page.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** The signed-in Windows user, for the print log. */
function windowsUser(): string {
  try {
    return userInfo().username
  } catch {
    return process.env['USERNAME'] ?? process.env['USER'] ?? ''
  }
}

// One app per PC: this PC's settings and log files are only ever written by one process.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('hk.nlth.pharmacy.tiny-2dcode-printing-app')

    registerIpc({
      dataFolder: resolveDataFolder({
        portableExecutableDir: process.env['PORTABLE_EXECUTABLE_DIR'],
        isPackaged: app.isPackaged,
        exePath: app.getPath('exe'),
        appPath: app.getAppPath()
      }),
      pcName: pcNameFromHostname(hostname()),
      windowsUser: windowsUser(),
      getMainWindow: () => mainWindow
    })

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
