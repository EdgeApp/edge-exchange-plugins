// @flow

import { asArray, asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asCoincapResponse = asObject({
  data: asObject({
    priceUsd: asString
  })
})

const asCoincapAssets = asArray(
  asObject({
    id: asString,
    symbol: asString
  })
)

const currencyMap = {}

export function makeCoincapPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io, log } = opts
  const fetch = io.fetchCors || io.fetch

  return {
    rateInfo: {
      pluginId: 'coincap',
      displayName: 'Coincap'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      if (Object.keys(currencyMap).length === 0) {
        const assets = await fetch(`https://api.coincap.io/v2/assets/`)
        const assetsJson = await assets.json()
        const assetIds = asCoincapAssets(assetsJson.data)
        assetIds.forEach(code => (currencyMap[code.symbol] = code.id))
      }
      for (const pair of pairsHint) {
        // Coincap only provides prices in USD and must be queried by unique identifier rather that currency code
        if (!currencyMap[pair.fromCurrency]) continue
        try {
          const reply = await fetch(
            `https://api.coincap.io/v2/assets/${currencyMap[pair.fromCurrency]}`
          )
          const json = await reply.json()
          const rate = parseFloat(asCoincapResponse(json).data.priceUsd)
          if (pair.fromCurrency === 'REP') {
            pairs.push({
              fromCurrency: 'REPV2',
              toCurrency: 'iso:USD',
              rate
            })
          }
          pairs.push({
            fromCurrency: pair.fromCurrency,
            toCurrency: 'iso:USD',
            rate
          })
        } catch (e) {
          log.warn(`Issue with Coincap rate data structure ${e}`)
        }
      }
      return pairs
    }
  }
}
