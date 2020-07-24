// @flow

import { asNumber, asObject } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asGeckoUsdReply = asObject({
  market_data: asObject({
    current_price: asObject({
      usd: asNumber
    })
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
      const reply = await io.fetch(
        'https://api.coingecko.com/api/v3/coins/telos?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false'
      )
      const json = await reply.json()

      // Grab all the pairs (TLOS to _______)
      const pairs = []
      try {
        const rate = asGeckoUsdReply(json).market_data.current_price.usd
        pairs.push({
          fromCurrency: 'TLOS',
          toCurrency: 'iso:USD',
          rate
        })
      } catch (error) {
        log('Issue with Coingecko rate data structure')
      }

      return pairs
    }
  }
}
