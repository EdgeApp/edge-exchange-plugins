import { NativeModules } from 'react-native'

const { EdgeExchangePluginsModule } = NativeModules
const { sourceUri } = EdgeExchangePluginsModule.getConstants()

export const pluginUri = sourceUri
export const debugUri = 'http://localhost:8083/edge-exchange-plugins.js'
