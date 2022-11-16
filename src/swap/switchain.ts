import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapCurrencyError
} from 'edge-core-js'

const pluginId = 'switchain'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Switchain',
  supportEmail: 'help@switchain.com'
}

export function makeSwitchainPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }
  }
  return out
}
