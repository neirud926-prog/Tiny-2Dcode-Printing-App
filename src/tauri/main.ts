/** The Tauri app's webview: the shared app service runs here, over the Rust platform and host. */
import { createAppService } from '../app/service'
import { setPlatform } from '../data/platform'
import { createTauriHost } from './host'
import { tauriPlatform } from './platform'

setPlatform(tauriPlatform)
void createTauriHost().then(async (host) => {
  window.api = createAppService(host)
  // The Electron app's screens, imported once window.api is there.
  await import('../renderer/src/main')
})
