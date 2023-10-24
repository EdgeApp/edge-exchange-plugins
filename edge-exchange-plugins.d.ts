import { EdgeCorePluginOptions, EdgeCurrencyPlugin } from 'edge-core-js/types'

/* Debug-mode URI to use on React Native. */
export const debugUri: string

/* Regular URI to use on React Native. */
export const pluginUri: string

type EdgeCorePluginFactory = (env: EdgeCorePluginOptions) => EdgeCurrencyPlugin

/**
 * The Node.js default export.
 */
declare const plugins: {
  [pluginId: string]: EdgeCorePluginFactory
}

export default plugins
