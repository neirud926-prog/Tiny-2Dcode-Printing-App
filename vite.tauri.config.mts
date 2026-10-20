// The Tauri app's webview: src/tauri/index.html (served from the project root, so it links the
// renderer's stylesheet as /src/renderer/src/styles.css) built to out-tauri/. Tauri runs it (src-tauri/tauri.conf.json).
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { version } from './package.json'

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  optimizeDeps: { entries: ['src/tauri/index.html'] },
  build: {
    outDir: 'out-tauri',
    emptyOutDir: true,
    rolldownOptions: { input: 'src/tauri/index.html' }
  }
})
