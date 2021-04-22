// @flow

import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asCoincapResponse = asObject({
  data: asArray(
    asObject({
      symbol: asString,
      priceUsd: asString
    })
  )
})

const asCoincapError = asObject({
  error: asOptional(asString),
  timestamp: asNumber
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
      // Create unique ID map
      if (Object.keys(currencyMap).length === 0) {
        const assets = await fetch(`https://api.coincap.io/v2/assets/`)
        const assetsJson = await assets.json()
        const assetIds = asCoincapAssets(assetsJson.data)
        assetIds.forEach(code => (currencyMap[code.symbol] = code.id))
      }

      // Create query strings
      const queryStrings = []
      let filteredPairs = []
      for (let i = 0; i < pairsHint.length; i++) {
        if (!currencyMap[pairsHint[i].fromCurrency]) continue
        if (pairsHint[i].fromCurrency.indexOf('iso:') >= 0) continue
        if (
          filteredPairs.some(
            cc => cc === currencyMap[pairsHint[i].fromCurrency]
          )
        )
          continue
        filteredPairs.push(currencyMap[pairsHint[i].fromCurrency])
        if (filteredPairs.length === 100 || i === pairsHint.length - 1) {
          queryStrings.push(filteredPairs.join(','))
          filteredPairs = []
        }
      }

      for (const query of queryStrings) {
        // Coincap only provides prices in USD
        try {
          const reply = await fetch(
            `https://api.coincap.io/v2/assets?ids=${query}`
          )
          const json = await reply.json()
          const { error } = asCoincapError(json)
          if ((error != null && error !== '') || reply.ok === false) {
            throw new Error(
              `CoincapHistorical returned code ${JSON.stringify(
                error ?? reply.status
              )}`
            )
          }
          asCoincapResponse(json).data.forEach(rate =>
            pairs.push({
              fromCurrency: rate.symbol,
              toCurrency: 'iso:USD',
              rate: Number(rate.priceUsd)
            })
          )
        } catch (e) {
          log.warn(`Issue with Coincap rate data structure ${e}`)
        }
      }
      return pairs
    }
  }
}
