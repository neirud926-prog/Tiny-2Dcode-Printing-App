/**
 * The narrow API the renderer may call, exposed on `window.api` by the preload script.
 * The renderer has no Node access; every capability it needs is added here explicitly.
 */
export type PreloadApi = Record<string, never>
