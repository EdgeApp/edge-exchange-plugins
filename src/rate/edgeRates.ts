import { asObject, asString } from 'cleaners'
import { EdgeCorePluginOptions, EdgeRatePlugin } from 'edge-core-js/types'

const asEdgeRatesResponse = asObject({
  exchangeRate: asString
})

function checkIfFiat(code: string): boolean {
  if (code.includes('iso:')) return true
  return false
}

export function makeEdgeRatesPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'edgeRates',
      displayName: 'EdgeRates'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      for (const pair of pairsHint) {
        // Skip if neither code is a fiat code
        if (!checkIfFiat(pair.fromCurrency) || !checkIfFiat(pair.toCurrency))
          continue

        const fiatFrom = pair.fromCurrency.split(':')
        const fiatTo = pair.toCurrency.split(':')
        try {
          const reply = await fetchCors(
            `https://rates1.edge.app/v1/exchangeRate?currency_pair=${fiatFrom[1]}_${fiatTo[1]}`
          )
          const jsonData = await reply.json()
          const rate = Number(asEdgeRatesResponse(jsonData).exchangeRate)
          pairs.push({
            fromCurrency: pair.fromCurrency,
            toCurrency: pair.toCurrency,
            rate
          })
        } catch (e) {
          log.warn(
            `Issue with EdgeRates rate data structure for ${
              pair.fromCurrency
            }/${pair.toCurrency} pair. Error: ${String(e)}`
          )
        }
      }
      return pairs
    }
  }
}
