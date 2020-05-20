import type {
  EdgeCorePluginOptions,
  EdgeRatePair,
  EdgeRatePlugin
} from 'edge-core-js'

export function makeCoinGeckoPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      pluginId: 'coingecko',
      displayName: 'CoinGecko'
    },
    async fetchRates(pairsHint): Promise<EdgeRatePair[]> {
      const response = await io.fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd'
      )
      const json = await response.json()

      if (!Array.isArray(json)) {
        throw new Error('response from CoinGecko was not an array')
      }

      // prices are in USD per crypto
      return json.map(coin => ({
        // coingecko returns symbols in lowercase
        fromCurrency: coin.symbol.toUpperCase(),
        toCurrency: 'iso:USD',
        rate: parseFloat(coin.current_price)
      }))
    }
  }
}
