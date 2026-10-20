/**
 * The app behind `window.api`, run in the Tauri webview: the host supplies where
 * the data lives, who and where this PC is, the file dialog, the printer list and printing.
 * Everything the renderer sends is validated here; the renderer can name a log folder, an Item
 * List file or a Stock Onhand report only by choosing it in the system dialog (or the default),
 * and never sends markup.
 */
import { localIsoDate } from '../core/expiry'
import { errorText } from '../data/atomicWrite'
import { checkDataFolder, checkFolderWritable } from '../data/dataFolder'
import { createItemListSource } from '../data/itemListStore'
import { addLabelSize, deleteLabelSize, isLabelSizeInUse, readLabelSizes } from '../data/labelSizeStore'
import { defaultLogFolder, loadPcSettings, resolveLogFolder, savePcSettings } from '../data/pcSettings'
import { appendPrintLog } from '../data/printLog'
import { createStockOnhandSource } from '../data/stockOnhandStore'
import type {
  AppStartup,
  DeleteExpiredOutcome,
  DeletePendingOutcome,
  ImportItemListOutcome,
  ImportStockOnhandOutcome,
  ItemLookup,
  LabelSizesList,
  PendingLabelsList,
  PreloadApi,
  PrintOutcome,
  SavePendingOutcome,
  SaveSettingsOutcome,
  StockLotsLookup
} from '../preload/api'
import { normalisePcSettings, printSettingsFor, type LabelSizeEntry, type PcSettings } from '../render/printSettings'
import type { AppHost } from './host'
import { itemLookupFor, stockLotsLookupFor } from './itemLookup'
import { deleteExpiredPendingLabels, deletePendingLabel, listPendingLabels, printPendingLabel, savePendingLabel } from './pendingService'
import { printerProblem, printLabelRequest, printTestLabel, type PrintContext, type PrintServiceDeps } from './printService'

/**
 * The API for one app window. The arguments are typed as the renderer sends them, but are checked
 * as untrusted input whatever the host passes.
 */
export function createAppService(host: AppHost): PreloadApi {
  const { dataFolder, pcName } = host
  const context: PrintContext = { dataFolder, pcName, windowsUser: host.windowsUser }
  const deps: PrintServiceDeps = { now: () => new Date(), sendToPrinter: (job) => host.sendToPrinter(job), appendLog: appendPrintLog }
  const itemLists = createItemListSource(dataFolder)
  const stockOnhand = createStockOnhandSource(dataFolder)

  /** True once the data folder passed its write check. */
  let folderReady = false
  let settings: PcSettings | null = null
  /** Log folders the renderer may save: the current one and any chosen in the dialog. */
  const allowedLogFolders = new Set<string>()
  let printing = false

  return {
    getStartup,
    importItemList,
    lookupItem,
    importStockOnhand,
    getStockLots,
    listPrinters: () => host.listPrinters(),
    chooseLogFolder,
    testPrint,
    savePrinterSettings,
    printLabel: (request) =>
      exclusively(async () => {
        const itemList = folderReady ? await itemLists.current() : null
        return printLabelRequest(request, folderReady ? settings : null, itemList?.index ?? null, context, deps)
      }),
    savePendingLabel: (request) =>
      folderReady ? savePendingLabel(request, context, deps) : Promise.resolve<SavePendingOutcome>({ ok: false, message: 'Not saved: the data folder is not ready.' }),
    listPendingLabels: listPendingLabelsNow,
    printPendingLabel: (id, packVolumeDigit) =>
      exclusively(async () => {
        const itemList = folderReady ? await itemLists.current() : null
        return printPendingLabel(id, packVolumeDigit, folderReady ? settings : null, itemList?.index ?? null, context, deps)
      }),
    deletePendingLabel: (id) =>
      folderReady ? deletePendingLabel(dataFolder, id) : Promise.resolve<DeletePendingOutcome>({ ok: false, message: 'The data folder is not ready.' }),
    deleteExpiredPendingLabels: () =>
      folderReady
        ? deleteExpiredPendingLabels(dataFolder, localIsoDate(deps.now()))
        : Promise.resolve<DeleteExpiredOutcome>({ ok: false, message: 'The data folder is not ready.' }),
    listLabelSizes: () => (folderReady ? readLabelSizes(dataFolder) : notReady()),
    addLabelSize: async (size) => {
      if (!folderReady) return notReady()
      const added = await addLabelSize(dataFolder, size)
      return added.ok ? readLabelSizes(dataFolder) : added
    },
    deleteLabelSize: async (id) => {
      if (!folderReady) return notReady()
      if (typeof id !== 'string') return { ok: false, message: 'The request is not valid.' }
      if (settings?.labelSizeId === id) {
        const sizes = await readLabelSizes(dataFolder)
        const name = sizes.ok ? sizes.sizes.find((size) => size.id === id)?.name : undefined
        return { ok: false, message: `The label size "${name ?? id}" is loaded in this printer. Change the label in Settings first.` }
      }
      const deleted = await deleteLabelSize(dataFolder, id, (sizeId) => isLabelSizeInUse(dataFolder, sizeId))
      return deleted.ok ? readLabelSizes(dataFolder) : deleted
    }
  }

  function notReady(): Promise<LabelSizesList> {
    return Promise.resolve({ ok: false, message: 'The data folder is not ready.' })
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

  async function listPendingLabelsNow(): Promise<PendingLabelsList> {
    if (!folderReady) return { ok: false, message: 'The data folder is not ready.' }
    return listPendingLabels(dataFolder, (await itemLists.current())?.index ?? null, localIsoDate(deps.now()))
  }

  async function importItemList(): Promise<ImportItemListOutcome> {
    if (!folderReady) return { status: 'refused', message: 'The data folder is not ready.', summary: null, badRows: [], warning: null }
    const file = await host.chooseFile({
      title: 'Import the Item List (item_phq.txt)',
      kind: 'file',
      filters: [
        { name: 'Item List (*.txt)', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (!file) return { status: 'cancelled' }
    return itemLists.importFile(file, { logFolder: currentLogFolder(), pcName, windowsUser: host.windowsUser, now: () => new Date() })
  }

  async function lookupItem(itemCode: unknown): Promise<ItemLookup> {
    return itemLookupFor(folderReady ? await itemLists.current() : null, itemCode)
  }

  async function importStockOnhand(): Promise<ImportStockOnhandOutcome> {
    if (!folderReady) return { status: 'refused', message: 'The data folder is not ready.', summary: null, badRows: [], warning: null }
    const file = await host.chooseFile({
      title: "Import today's Stock Onhand (HA: INV Stock onhand with lot details)",
      kind: 'file',
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
      windowsUser: host.windowsUser,
      now: () => new Date(),
      itemIndex: itemList?.index ?? null
    })
  }

  async function getStockLots(itemCode: unknown): Promise<StockLotsLookup> {
    return stockLotsLookupFor(folderReady ? await stockOnhand.current() : null, itemCode)
  }

  async function chooseLogFolder(): Promise<string | null> {
    const folder = await host.chooseFile({ title: 'Choose the log folder', kind: 'folder', defaultPath: currentLogFolder() })
    if (!folder) return null
    allowedLogFolders.add(folder)
    return folder
  }

  async function testPrint(input: unknown): Promise<PrintOutcome> {
    const checked = await checkSettings(input)
    if (!checked.ok) return { ok: false, message: `Test print failed: ${checked.message}` }
    return exclusively(() => printTestLabel(printSettingsFor(checked.settings, checked.size), deps))
  }

  async function savePrinterSettings(input: unknown): Promise<SaveSettingsOutcome> {
    if (!folderReady) return { ok: false, message: 'The data folder is not ready.' }
    const checked = await checkSettings(input)
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

  /** Checks settings, that their printer is installed and their Label Size is in the list (which it returns). */
  async function checkSettings(input: unknown): Promise<{ ok: true; settings: PcSettings; size: LabelSizeEntry } | { ok: false; message: string }> {
    const normalised = normalisePcSettings(input)
    if (!normalised.ok) return { ok: false, message: normalised.errors.map((error) => error.message).join(' ') }
    const problem = printerProblem(normalised.settings.printerName, await host.listPrinters())
    if (problem) return { ok: false, message: problem }
    const sizes = await readLabelSizes(dataFolder)
    if (!sizes.ok) return sizes
    const size = sizes.sizes.find((entry) => entry.id === normalised.settings.labelSizeId)
    if (!size) return { ok: false, message: 'That label size is no longer in the list. Choose the label in this printer.' }
    return { ok: true, settings: normalised.settings, size }
  }
}
