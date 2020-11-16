// @flow

import { asMap, asNumber, asObject } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asGeckoUsdReply = asObject({
  market_data: asObject({
    current_price: asMap(asNumber)
  })
})

export function makeCoinGeckoPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts

  return {
    rateInfo: {
      displayName: 'Coingecko',
      pluginId: 'coingecko'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      let rates
      for (const pair of pairsHint) {
        // Coingecko is only used to query TLOS price
        if (pair.fromCurrency !== 'TLOS') continue
        try {
          if (rates === undefined) {
            const reply = await io.fetch(
              'https://api.coingecko.com/api/v3/coins/telos?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false'
            )
            const json = await reply.json()
            rates = asGeckoUsdReply(json)
          }
          const fiatCode = pair.toCurrency.split(':')
          const rate =
            rates.market_data.current_price[fiatCode[1].toLowerCase()]
          pairs.push({
            fromCurrency: pair.fromCurrency,
            toCurrency: pair.toCurrency,
            rate
          })
        } catch (e) {
          log(`Issue with Coingecko rate data structure ${e}`)
        }
      }
      return pairs
    }
  }
}
