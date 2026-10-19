/** The app's title bar; `children` sit at its right-hand end. */
export function AppHeader({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <header className="app-header">
      <h1>Tiny 2D-code Printing App</h1>
      <span className="app-header__note">GS1 DataMatrix labels · Internal GTIN, Expiry, Lot</span>
      {children && <div className="app-header__end">{children}</div>}
    </header>
  )
}
