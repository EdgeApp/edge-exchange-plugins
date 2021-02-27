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
  const { io, log } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'coinmonitor',
      displayName: 'coinmonitor'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      for (const pair of pairsHint) {
        if (pair.fromCurrency === 'BTC' && pair.toCurrency === 'iso:ARS') {
          try {
            const response = await fetchCors(
              'https://ar.coinmonitor.info/api/v3/btc_ars'
            )
            const json = await response.json()
            const rate = Number(asCoinmonitorTickerResponse(json).mediana_prom)
            pairs.push({
              fromCurrency: 'BTC',
              toCurrency: 'iso:ARS',
              rate
            })
          } catch (e) {
            log.warn(`Issue with Coinmonitor rate data structure ${e}`)
          }
          break
        }
      }
      return pairs
    }
  }
}
