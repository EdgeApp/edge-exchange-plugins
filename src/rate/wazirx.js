// @flow

import { asMap, asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asWazirxResponse = asMap(
  asObject({
    last: asString
  })
)

function fixCurrency(currencyCode) {
  currencyCode = currencyCode.toUpperCase()

  if (currencyCode === 'BCHABC') currencyCode = 'BCH'

  return currencyCode
}

export function makeWazirxPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'wazirx',
      displayName: 'WazirX'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      let rates
      for (const pair of pairsHint) {
        // Wazirx is only used to query INR exchange rates
        if (pair.toCurrency !== 'iso:INR') continue

        try {
          if (rates === undefined) {
            const reply = await fetchCors(
              'https://api.wazirx.com/api/v2/tickers'
            )
            const json = await reply.json()
            rates = asWazirxResponse(json)
          }

          const cc = fixCurrency(pair.fromCurrency).toLowerCase()
          const currencyPair = `${cc}inr`
          if (rates && rates[currencyPair]) {
            pairs.push({
              fromCurrency: pair.fromCurrency,
              toCurrency: 'iso:INR',
              rate: Number(rates[currencyPair].last)
            })
          }
        } catch (e) {
          log.warn(`Issue with Wazirx rate data structure ${e}`)
        }
      }
      return pairs
    }
  }
}
