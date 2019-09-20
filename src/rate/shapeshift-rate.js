// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

export function makeShapeshiftRatePlugin (
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      displayName: 'Shapeshift'
    },

    async fetchRates (pairsHint) {
      // endpoint appears to be deprecated
      const reply = await io.fetch('https://shapeshift.io/marketinfo/')
      const json = await reply.json()

      // Grab all the BTC pairs:
      const pairs = []
      for (const entry of json) {
        const currency = entry.pair.replace(/BTC_/, '')
        if (currency === entry.pair) continue

        pairs.push({
          fromCurrency: 'BTC',
          toCurrency: currency,
          rate: entry.rate
        })
      }

      return pairs
    }
  }
}
