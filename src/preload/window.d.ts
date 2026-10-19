import type { PreloadApi } from './api'

declare global {
  interface Window {
    api: PreloadApi
  }
}
