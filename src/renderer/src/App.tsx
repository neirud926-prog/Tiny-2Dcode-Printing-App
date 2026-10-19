import { useEffect, useState } from 'react'
import type { ItemListInfo } from '../../core/itemList'
import type { AppStartup } from '../../preload/api'
import type { PcSettings } from '../../render/printSettings'
import { AppHeader } from './AppHeader'
import { ItemListPanel } from './ItemListImport'
import { LabelScreen } from './LabelScreen'
import { PrinterSettingsScreen } from './PrinterSettingsScreen'

/**
 * Startup: the data folder must be writable. Setup then asks for what is missing, in order: the
 * Item List (shared by every PC, so imported once), then this PC's printer. Later launches open
 * straight to the label screen.
 */
function App(): React.JSX.Element {
  const [startup, setStartup] = useState<AppStartup | null>(null)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [settings, setSettings] = useState<PcSettings | null>(null)
  const [itemList, setItemList] = useState<ItemListInfo | null>(null)
  /** The Setup step "Item List" stays up, showing the import summary, until Continue. */
  const [itemListStep, setItemListStep] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)

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
        }
      },
      (error: unknown) => current && setStartupError(String(error))
    )
    return () => {
      current = false
    }
  }, [])

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
        onOpenSettings={() => setEditingSettings(true)}
        hidden={editingSettings}
      />
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
