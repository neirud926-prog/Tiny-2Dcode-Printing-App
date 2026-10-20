import { AppLogo } from './AppLogo'

/** The app's title bar; `children` sit at its right-hand end. */
export function AppHeader({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <header className="app-header">
      <h1 className="app-header__title">
        <AppLogo />
        2D Code Print
      </h1>
      <span className="app-header__note">GS1 DataMatrix labels · Internal GTIN, Expiry, Lot</span>
      <span className="app-header__note">v{__APP_VERSION__}</span>
      {children && <div className="app-header__end">{children}</div>}
    </header>
  )
}
