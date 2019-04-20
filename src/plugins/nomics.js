// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

export function makeNomicsPlugin (opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io, initOptions } = opts
  const { apiKey } = initOptions

  if (apiKey == null) {
    throw new Error('No Nomics exchange rates API key provided')
  }
  return {
    rateInfo: {
      displayName: 'Nomics'
    },

    async fetchRates (pairsHint) {
      console.log(
        'about to fetch nomics reates with apiKey: ',
        apiKey,
        ' opts is: ',
        opts
      )
      const reply = await io.fetch(
        `https://api.nomics.com/v1/prices?key=${apiKey}`
      )
      const json = await reply.json()

      // Grab all the pairs which are in USD:
      const pairs = []
      for (const entry of json.data) {
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
