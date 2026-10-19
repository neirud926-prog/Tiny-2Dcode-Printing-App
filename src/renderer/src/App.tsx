import { useEffect, useState } from 'react'
import type { AppStartup } from '../../preload/api'
import type { PcSettings } from '../../render/printSettings'
import { AppHeader } from './AppHeader'
import { LabelScreen } from './LabelScreen'
import { PrinterSettingsScreen } from './PrinterSettingsScreen'

/**
 * Startup: the data folder must be writable; a PC with no (usable) settings goes to the Setup step
 * "Printer"; later launches open straight to the label screen.
 */
function App(): React.JSX.Element {
  const [startup, setStartup] = useState<AppStartup | null>(null)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [settings, setSettings] = useState<PcSettings | null>(null)
  const [editingSettings, setEditingSettings] = useState(false)

  useEffect(() => {
    let current = true
    window.api.getStartup().then(
      (result) => {
        if (!current) return
        setStartup(result)
        if (result.status === 'ready') setSettings(result.settings)
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
      <LabelScreen settings={settings} onOpenSettings={() => setEditingSettings(true)} hidden={editingSettings} />
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
        />
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
