// @flow

import { asArray, asEither, asNull, asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asEdgeRatesResponse = asObject({
  data: asArray(
    asObject({
      currency_pair: asString,
      date: asString,
      exchangeRate: asEither(asNull, asString)
    })
  )
})

export function makeEdgeRatesPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts
  const { fetch } = io

  return {
    rateInfo: {
      pluginId: 'edgeRates',
      displayName: 'EdgeRates'
    },

    async fetchRates(pairsHint) {
      const pairs = []

      const data = []
      pairsHint.forEach(pair =>
        data.push({
          currency_pair: `${pair.fromCurrency}_${pair.toCurrency}`
        })
      )

      while (data.length > 0) {
        const options = {
          headers: {
            'Content-Type': 'application/json'
          },
          method: 'POST',
          body: JSON.stringify({ data: data.splice(0, 100) })
        }
        try {
          const reply = await fetch(
            `https://rates2.edge.app/v2/exchangeRates`,
            options
          )
          const json = asEdgeRatesResponse(await reply.json())
          json.data.forEach(rate => {
            if (rate.exchangeRate != null)
              pairs.push({
                fromCurrency: rate.currency_pair.split('_')[0],
                toCurrency: rate.currency_pair.split('_')[1],
                rate: Number(rate.exchangeRate)
              })
          })
        } catch (e) {
          log.warn(`Issue with EdgeRates rate data structure. Error: ${e}`)
        }
      }

      return pairs
    }
  }
}
