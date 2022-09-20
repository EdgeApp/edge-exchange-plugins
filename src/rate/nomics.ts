import { asArray, asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeRatePair,
  EdgeRatePlugin
} from 'edge-core-js/types'

const asNomicsResponse = asArray(
  asObject({
    price: asOptional(asString),
    symbol: asString
  })
)

const UNIQUE_ID_MAP: { [cc: string]: string } = {
  BOO: 'BOO4'
}

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
      const pairs: EdgeRatePair[] = []

      // Create query strings
      const queryStrings = []
      let filteredPairs: string[] = []
      for (let i = 0; i < pairsHint.length; i++) {
        if (pairsHint[i].fromCurrency.includes('iso:')) continue
        if (filteredPairs.some(cc => cc === pairsHint[i].fromCurrency)) continue
        filteredPairs.push(
          UNIQUE_ID_MAP[pairsHint[i].fromCurrency] ?? pairsHint[i].fromCurrency
        )
        if (filteredPairs.length === 100 || i === pairsHint.length - 1) {
          queryStrings.push(filteredPairs.join(','))
          filteredPairs = []
        }
      }

      for (const query of queryStrings) {
        try {
          const reply = await fetchCors(
            `https://api.nomics.com/v1/currencies/ticker?key=${apiKey}&ids=${query}&convert=USD`
          )
          if (reply.status === 429 || reply.status === 401 || !reply.ok)
            throw new Error(`Nomics returned with status: ${reply.status}`)
          asNomicsResponse(await reply.json()).forEach(rate => {
            // When Nomics considers a coin "dead" they don't return a price
            if (rate.price != null)
              pairs.push({
                fromCurrency: rate.symbol,
                toCurrency: 'iso:USD',
                rate: Number(rate.price)
              })
          })
        } catch (e: any) {
          log.warn(
            `Issue with Nomics rate data structure. Error: ${e.message ?? ''}`
          )
        }
      }
      return pairs
    }
  }
}
