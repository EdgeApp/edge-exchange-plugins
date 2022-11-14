import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapCurrencyError
} from 'edge-core-js'

const pluginId = 'foxExchange'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Fox Exchange',
  supportEmail: 'support@fox.exchange'
}

export function makeFoxExchangePlugin(
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
