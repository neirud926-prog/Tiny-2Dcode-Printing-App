import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // The app version from package.json, shown in the header (`v0.1.0`).
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react()]
  }
})
