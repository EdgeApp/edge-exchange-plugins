// @flow

import { asArray, asObject, asOptional, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asEdgeRatesExchangeRate = asObject({
  data: asObject({
    currency_pair: asString,
    date: asOptional(asString),
    exchangeRate: asOptional(asString),
    errors: asOptional(
      asObject({
        name: asString,
        message: asString,
        stack: asOptional(asString)
      })
    )
  })
})

// const asEdgeRatesExchangeRate = asObject({
//   data: asObject({
//     currency_pair: asOptional(asString),
//     date: asOptional(asString),
//     exchangeRate: asOptional(asString),
//     errors: asOptional(
//       asObject({
//         name: asString,
//         message: asString,
//         stack: asOptional(asString)
//       })
//     )
//   })
// })

const asEdgeRatesResponse = asObject({
  data: asArray(asEdgeRatesExchangeRate)
})

function checkIfFiat(code: string): boolean {
  if (code.indexOf('iso:') >= 0) return true
  return false
}

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
      let queryPairs = []
      const queryArrays = []
      for (let i = 0; i < pairsHint.length; i++) {
        queryPairs.push(
          `${
            checkIfFiat(pairsHint[i].fromCurrency)
              ? pairsHint[i].fromCurrency.split(':')[1]
              : pairsHint[i].fromCurrency
          }_${
            checkIfFiat(pairsHint[i].toCurrency)
              ? pairsHint[i].toCurrency.split(':')[1]
              : pairsHint[i].toCurrency
          }`
        )

        if (queryPairs.length === 100 || i === pairsHint.length - 1) {
          queryArrays.push(queryPairs)
          queryPairs = []
        }
      }
      for (const query of queryArrays) {
        const body = JSON.stringify({ pairs: query })
        try {
          const reply = await fetch(
            `https://rates1.edge.app/v1/exchangeRates`,
            {
              method: 'POST',
              body
            }
          )
          const jsonData = asEdgeRatesResponse(await reply.json())
          for (const exchangeRateObj of Object.keys(jsonData.data)) {
            try {
              const rateObj = asEdgeRatesExchangeRate(exchangeRateObj).data
              if (rateObj.errors) throw new Error(rateObj.errors.message)
              pairs.push({
                fromCurrency: rateObj.currency_pair.split('_')[0],
                toCurrency: rateObj.currency_pair.split('_')[1],
                rate: Number(rateObj.exchangeRate)
              })
            } catch (e) {
              log.warn(
                `Issue with EdgeRates rate data structure for ${JSON.stringify(
                  exchangeRateObj
                )}. Error: ${e}`
              )
            }
          }
        } catch (e) {
          log.warn(`Issue with EdgeRates response data structure. Error: ${e}`)
        }
      }

      return pairs
    }
  }
}
