// @flow

import { asMap, asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asCoinbaseResponse = asObject({
  data: asObject({
    rates: asMap(asString)
  })
})

export function makeCoinbasePlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'coinbase',
      displayName: 'Coinbase'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      try {
        const reply = await fetchCors(
          'https://api.coinbase.com/v2/exchange-rates'
        )
        const json = await reply.json()
        const cleanJson = asCoinbaseResponse(json)
        for (const pair of pairsHint) {
          const cc = pair.fromCurrency
          if (!cleanJson.data.rates[cc]) continue
          const rate = Number(cleanJson.data.rates[cc])
          pairs.push({
            fromCurrency: 'iso:USD',
            toCurrency: cc,
            rate
          })
        }
      } catch (e) {
        log.warn(`Issue with Coinbase rate data structure ${e}`)
      }
      return pairs
    }
  }
}
