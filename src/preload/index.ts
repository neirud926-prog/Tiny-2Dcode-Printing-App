import { contextBridge } from 'electron'
import type { PreloadApi } from './api'

const api: PreloadApi = {}

contextBridge.exposeInMainWorld('api', api)
