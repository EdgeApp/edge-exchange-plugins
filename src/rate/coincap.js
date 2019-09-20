// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

import { DUPLICATE_RATE_MAP } from '../rate-helpers.js'

export function makeCoincapPlugin (opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      displayName: 'Coincap'
    },

    // crypto-to-fiat
    async fetchRates (pairsHint) {
      const reply = await io.fetch('https://api.coincap.io/v2/assets')
      const json = await reply.json()

      // Grab all the pairs which are in USD:
      const pairs = []
      for (const entry of json.data) {
        if (typeof entry.symbol !== 'string') continue
        if (typeof entry.priceUsd !== 'string') continue
        const currency = entry.symbol
        const rate = parseFloat(entry.priceUsd)
        pairs.push({
          fromCurrency: currency,
          toCurrency: 'iso:USD',
          rate
        })
        if (DUPLICATE_RATE_MAP[currency]) {
          pairs.push({
            fromCurrency: DUPLICATE_RATE_MAP[currency],
            toCurrency: 'iso:USD',
            rate
          })
        }
      }
      pairs.push({
        fromCurrency: 'TBTC',
        toCurrency: 'iso:USD',
        rate: 0.01
      })

      return pairs
    }
  }
}
