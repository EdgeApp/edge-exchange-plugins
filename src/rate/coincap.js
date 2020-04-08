// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

export function makeCoincapPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      pluginId: 'coincap',
      displayName: 'Coincap'
    },

    async fetchRates(pairsHint) {
      const reply = await io.fetch('https://api.coincap.io/v2/assets?limit=500')
      const json = await reply.json()

      // Grab all the pairs which are in USD:
      const pairs = []
      for (const entry of json.data) {
        if (typeof entry.symbol !== 'string') continue
        if (typeof entry.priceUsd !== 'string') continue
        const currency = entry.symbol

        pairs.push({
          fromCurrency: currency,
          toCurrency: 'iso:USD',
          rate: parseFloat(entry.priceUsd)
        })
      }

      return pairs
    }
  }
}
