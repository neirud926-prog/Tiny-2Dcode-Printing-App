import { useEffect, useRef, useState } from 'react'
import { formatFileDate, describeItemList, type ItemListInfo } from '../../core/itemList'
import { isStockOnhandForToday, type StockOnhandInfo } from '../../core/stockOnhand'
import type { AppStartup } from '../../preload/api'
import type { PcSettings } from '../../render/printSettings'
import { AppHeader } from './AppHeader'
import { CustomLabelScreen } from './CustomLabelScreen'
import { ItemListPanel } from './ItemListImport'
import { LabelScreen } from './LabelScreen'
import { PrinterSettingsScreen } from './PrinterSettingsScreen'
import { StockOnhandPanel, StockOnhandPrompt, StockOnhandStatus } from './StockOnhandImport'
import { useToday } from './today'

const TABS = [
  { id: 'gtin', label: 'GTIN Label' },
  { id: 'custom', label: 'Custom Label' },
  { id: 'settings', label: 'Settings' }
] as const
type TabId = (typeof TABS)[number]['id']

/**
 * Startup: the data folder must be writable. Setup then asks for what is missing, in order: the
 * Item List (shared by every PC, so imported once), then this PC's printer. Later launches open
 * straight to the label screen. Once Setup is complete, a launch with no Stock Onhand dated today
 * asks for today's file once (Import, or Skip and type Lots by hand). After Setup, three tabs:
 * GTIN Label, Custom Label and Settings, all kept mounted so each keeps what was typed.
 */
function App(): React.JSX.Element {
  const [startup, setStartup] = useState<AppStartup | null>(null)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [settings, setSettings] = useState<PcSettings | null>(null)
  const [itemList, setItemList] = useState<ItemListInfo | null>(null)
  /** The Setup step "Item List" stays up, showing the import summary, until Continue. */
  const [itemListStep, setItemListStep] = useState(false)
  const [tab, setTab] = useState<TabId>('gtin')
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  const tabButtons = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})
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

  /** Arrow keys, Home and End move between tabs (and open the one reached). */
  function onTabKey(event: React.KeyboardEvent): void {
    const index = TABS.findIndex((t) => t.id === tab)
    const next =
      event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? TABS.length - 1
      : null
    if (next === null) return
    event.preventDefault()
    setTab(TABS[next].id)
    tabButtons.current[TABS[next].id]?.focus()
  }

  return (
    <div className="screen">
      <AppHeader>
        <span className="header-info" title={describeItemList(itemList)}>
          Item List <strong>{formatFileDate(itemList.sourceModified)}</strong>
        </span>
        <StockOnhandStatus stockOnhand={stockOnhand} today={today} />
        <span className="header-info">
          Printer <strong>{settings.printerName}</strong>
        </span>
        <span ref={setHeaderSlot} className="app-header__slot" />
      </AppHeader>
      <div className="tabs" role="tablist" aria-label="Screens" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(element) => {
              tabButtons.current[t.id] = element
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            className="tabs__tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-gtin" aria-labelledby="tab-gtin" hidden={tab !== 'gtin'}>
        <LabelScreen
          itemList={itemList}
          onItemListChanged={setItemList}
          stockOnhand={stockOnhand}
          onStockOnhandChanged={setStockOnhand}
          headerSlot={headerSlot}
          hidden={tab !== 'gtin'}
        />
      </div>
      <div role="tabpanel" id="panel-custom" aria-labelledby="tab-custom" hidden={tab !== 'custom'}>
        <CustomLabelScreen settings={settings} />
      </div>
      <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" hidden={tab !== 'settings'}>
        <PrinterSettingsScreen
          mode="settings"
          pcName={startup.pcName}
          defaultLogFolder={startup.defaultLogFolder}
          initial={settings}
          onSaved={setSettings}
        >
          <ItemListPanel mode="settings" itemList={itemList} onImported={setItemList} />
          <StockOnhandPanel stockOnhand={stockOnhand} today={today} onImported={setStockOnhand} />
        </PrinterSettingsScreen>
      </div>

      {stockPrompt === 'open' && (
        <StockOnhandPrompt
          stockOnhand={stockOnhand}
          today={today}
          notice={startup.stockOnhandNotice}
          onImported={setStockOnhand}
          onClose={() => setStockPrompt('done')}
        />
      )}
    </div>
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
