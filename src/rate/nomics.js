// @flow

import { asArray, asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asNomicsResponse = asArray(
  asObject({
    price: asString
  })
)

export function makeNomicsPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io, initOptions, log } = opts
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

    async fetchRates(pairsHint) {
      const pairs = []
      for (const pair of pairsHint) {
        const fiatCode = pair.toCurrency.split(':')
        try {
          const reply = await fetchCors(
            `https://api.nomics.com/v1/currencies/ticker?key=${apiKey}&ids=${pair.fromCurrency}&convert=${fiatCode[1]}`
          )
          const jsonData = await reply.json()
          const rate = Number(asNomicsResponse(jsonData)[0].price)
          pairs.push({
            fromCurrency: pair.fromCurrency,
            toCurrency: pair.toCurrency,
            rate
          })
        } catch (e) {
          log(`Issue with Nomics rate data structure ${e}`)
        }
      }
      return pairs
    }
  }
}
