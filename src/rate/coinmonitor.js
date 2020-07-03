// @flow

import { asObject, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asCoinmonitorTickerResponse = asObject({ mediana_prom: asString })

export function makeCoinmonitorPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'coinmonitor',
      displayName: 'coinmonitor'
    },

    async fetchRates(pairsHint) {
      const response = await fetchCors(
        'https://ar.coinmonitor.info/api/v3/btc_ars'
      )
      if (!response.ok) return []

      const json = await response.json()
      asCoinmonitorTickerResponse(json)
      return [
        {
          fromCurrency: 'BTC',
          toCurrency: 'iso:ARS',
          rate: Number(json.mediana_prom)
        }
      ]
    }
  }
}
