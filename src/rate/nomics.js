// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

export function makeNomicsPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io, initOptions } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = initOptions

  if (apiKey == null) {
    throw new Error('No Nomics exchange rates API key provided')
  }
  return {
    rateInfo: {
      pluginId: 'nomics',
      displayName: 'Nomics'
    },

    async fetchRates() {
      const reply = await fetchCors(
        `https://api.nomics.com/v1/prices?key=${apiKey}`
      )
      const jsonData = await reply.json()
      // Grab all the pairs which are in USD:
      const pairs = []
      for (const entry of jsonData) {
        if (typeof entry.currency !== 'string') continue
        if (typeof entry.price !== 'string') continue
        const currency = entry.currency

        pairs.push({
          fromCurrency: currency,
          toCurrency: 'iso:USD',
          rate: parseFloat(entry.price)
        })
      }

      return pairs
    }
  }
}
