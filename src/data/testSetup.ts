// Vitest runs the data layer on Node, as the Electron main process does.
import { nodePlatform } from './nodePlatform'
import { setPlatform } from './platform'

setPlatform(nodePlatform)
