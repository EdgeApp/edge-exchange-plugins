// @flow

import { asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asBitMaxTickerResponse = asObject({ data: asObject({ close: asString }) })

export function makeBitMaxPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'bitmax',
      displayName: 'BitMax'
    },

    async fetchRates(pairsHint) {
      const response = await fetchCors(
        'https://bitmax.io/api/pro/v1/ticker?symbol=FIO/USDT'
      )
      const json = await response.json()
      if (!response.ok || json.reason === 'DATA_NOT_AVAILABLE') {
        // Return fixed rate if data is unavailable
        return [
          {
            fromCurrency: 'FIO',
            toCurrency: 'USDT',
            rate: 0.001
          }
        ]
      }
      asBitMaxTickerResponse(json)
      return [
        {
          fromCurrency: 'FIO',
          toCurrency: 'USDT',
          rate: Number(json.data.close)
        }
      ]
    }
  }
}
