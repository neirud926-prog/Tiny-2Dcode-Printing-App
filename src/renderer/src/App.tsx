import { useEffect, useState } from 'react'
import type { ItemListInfo } from '../../core/itemList'
import { isStockOnhandForToday, type StockOnhandInfo } from '../../core/stockOnhand'
import type { AppStartup } from '../../preload/api'
import type { PcSettings } from '../../render/printSettings'
import { AppHeader } from './AppHeader'
import { ItemListPanel } from './ItemListImport'
import { LabelScreen } from './LabelScreen'
import { PrinterSettingsScreen } from './PrinterSettingsScreen'
import { StockOnhandPanel, StockOnhandPrompt } from './StockOnhandImport'
import { useToday } from './today'

/**
 * Startup: the data folder must be writable. Setup then asks for what is missing, in order: the
 * Item List (shared by every PC, so imported once), then this PC's printer. Later launches open
 * straight to the label screen. Once Setup is complete, a launch with no Stock Onhand dated today
 * asks for today's file once (Import, or Skip and type Lots by hand).
 */
function App(): React.JSX.Element {
  const [startup, setStartup] = useState<AppStartup | null>(null)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [settings, setSettings] = useState<PcSettings | null>(null)
  const [itemList, setItemList] = useState<ItemListInfo | null>(null)
  /** The Setup step "Item List" stays up, showing the import summary, until Continue. */
  const [itemListStep, setItemListStep] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)
  const [stockOnhand, setStockOnhand] = useState<StockOnhandInfo | null>(null)
  /** The launch prompt for today's Stock Onhand: not decided yet, showing, or done for this launch. */
  const [stockPrompt, setStockPrompt] = useState<'pending' | 'open' | 'done'>('pending')
  const today = useToday()

  useEffect(() => {
    let current = true
    window.api.getStartup().then(
      (result) => {
        if (!current) return
        setStartup(result)
        if (result.status === 'ready') {
          setSettings(result.settings)
          setItemList(result.itemList)
          setItemListStep(result.itemList === null)
          setStockOnhand(result.stockOnhand)
        }
      },
      (error: unknown) => current && setStartupError(String(error))
    )
    return () => {
      current = false
    }
  }, [])

  const setupComplete = startup?.status === 'ready' && itemList !== null && !itemListStep && settings !== null
  useEffect(() => {
    if (setupComplete && stockPrompt === 'pending') setStockPrompt(isStockOnhandForToday(stockOnhand, today) ? 'done' : 'open')
  }, [setupComplete, stockPrompt, stockOnhand, today])

  if (startupError) {
    return <FullScreenMessage title="The app could not start." detail={startupError} />
  }
  if (!startup) {
    return (
      <div className="screen">
        <AppHeader />
        <p className="starting">Starting…</p>
      </div>
    )
  }
  if (startup.status === 'folder-error') {
    return <FullScreenMessage title={startup.message} detail={startup.reason} />
  }

  if (itemListStep || !itemList) {
    return (
      <div className="screen">
        <AppHeader>
          <span className="header-info">PC {startup.pcName}</span>
        </AppHeader>
        <main className="settings-layout">
          <ItemListPanel
            mode="setup"
            itemList={itemList}
            notice={startup.itemListNotice}
            onImported={setItemList}
            onContinue={() => setItemListStep(false)}
          />
        </main>
      </div>
    )
  }

  if (!settings) {
    return (
      <PrinterSettingsScreen
        mode="setup"
        pcName={startup.pcName}
        defaultLogFolder={startup.defaultLogFolder}
        notice={startup.settingsNotice}
        onSaved={setSettings}
      />
    )
  }

  return (
    <>
      {/* The label screen stays mounted under Settings, so the form keeps what was typed. */}
      <LabelScreen
        settings={settings}
        itemList={itemList}
        onItemListChanged={setItemList}
        stockOnhand={stockOnhand}
        onStockOnhandChanged={setStockOnhand}
        onOpenSettings={() => setEditingSettings(true)}
        hidden={editingSettings}
      />
      {stockPrompt === 'open' && (
        <StockOnhandPrompt
          stockOnhand={stockOnhand}
          today={today}
          notice={startup.stockOnhandNotice}
          onImported={setStockOnhand}
          onClose={() => setStockPrompt('done')}
        />
      )}
      {editingSettings && (
        <PrinterSettingsScreen
          mode="settings"
          pcName={startup.pcName}
          defaultLogFolder={startup.defaultLogFolder}
          initial={settings}
          onSaved={(saved) => {
            setSettings(saved)
            setEditingSettings(false)
          }}
          onCancel={() => setEditingSettings(false)}
        >
          <ItemListPanel mode="settings" itemList={itemList} onImported={setItemList} />
          <StockOnhandPanel stockOnhand={stockOnhand} today={today} onImported={setStockOnhand} />
        </PrinterSettingsScreen>
      )}
    </>
  )
}

function FullScreenMessage({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return (
    <div className="screen">
      <AppHeader />
      <main className="full-screen-message" role="alert">
        <h2>{title}</h2>
        <p className="full-screen-message__detail">{detail}</p>
      </main>
    </div>
  )
}

export default App
