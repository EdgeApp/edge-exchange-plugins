import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  JsonObject
} from 'edge-core-js'

type EdgeCorePluginFactory = (env: EdgeCorePluginOptions) => EdgeSwapPlugin

export interface PluginEnvironment extends EdgeCorePluginOptions {
  swapInfo: EdgeSwapInfo
}

/**
 * These methods involve expensive crypto libraries
 * that we don't want to load unless we actually perform a swap.
 */
export interface InnerPlugin {
  fetchSwapQuote: (
    env: PluginEnvironment,
    request: EdgeSwapRequest,
    userSettings: JsonObject | undefined,
    opts: { promoCode?: string }
  ) => Promise<EdgeSwapQuote>
}

/**
 * These methods involve cheap, static information,
 * so we don't have to load any crypto libraries.
 */
export interface OuterPlugin {
  swapInfo: EdgeSwapInfo
  checkEnvironment?: () => void
  getInnerPlugin: () => Promise<InnerPlugin>
}

export function makeSwapPlugin(template: OuterPlugin): EdgeCorePluginFactory {
  const { swapInfo, checkEnvironment = () => {} } = template

  return (env: EdgeCorePluginOptions): EdgeSwapPlugin => {
    const innerEnv = { ...env, swapInfo }
    let pluginPromise: Promise<InnerPlugin> | undefined

    return {
      swapInfo,
      async fetchSwapQuote(request, userSettings, opts) {
        checkEnvironment()
        if (pluginPromise == null) {
          pluginPromise = template.getInnerPlugin()
        }
        const plugin = await pluginPromise

        return await plugin.fetchSwapQuote(
          innerEnv,
          request,
          userSettings,
          opts
        )
      }
    }
  }
}
