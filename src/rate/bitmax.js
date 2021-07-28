// @flow

import { asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asBitMaxTickerResponse = asObject({ data: asObject({ close: asString }) })

export function makeBitMaxPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'bitmax',
      displayName: 'BitMax'
    },

    async fetchRates(pairsHint) {
      for (const pair of pairsHint) {
        // BitMax is only used to query FIO price
        if (pair.fromCurrency !== 'FIO') continue
        try {
          const response = await fetchCors(
            'https://ascendex.com/api/pro/v1/ticker?symbol=FIO/USDT'
          )
          const json = await response.json()
          if (!response.ok || json.reason === 'DATA_NOT_AVAILABLE') {
            // Return fixed rate if data is unavailable
            break
          }
          const rate = Number(asBitMaxTickerResponse(json).data.close)
          return [
            {
              fromCurrency: 'FIO',
              toCurrency: 'USDT',
              rate
            }
          ]
        } catch (e) {
          log.warn(`Issue with Bitmax rate data structure ${e}`)
          break
        }
      }
      return []
    }
  }
}
