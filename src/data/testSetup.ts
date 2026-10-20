// Vitest runs the data layer on Node.
import { nodePlatform } from './nodePlatform'
import { setPlatform } from './platform'

setPlatform(nodePlatform)
