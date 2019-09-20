// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

import { DUPLICATE_RATE_MAP } from '../rate-helpers.js'

export function makeNomicsPlugin (opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io, initOptions } = opts
  const { apiKey } = initOptions

  if (apiKey == null) {
    throw new Error('No Nomics exchange rates API key provided')
  }
  return {
    rateInfo: {
      displayName: 'Nomics'
    },
    // crypto-to-fiat
    async fetchRates () {
      const reply = await io.fetch(
        `https://api.nomics.com/v1/prices?key=${apiKey}`
      )
      const jsonData = await reply.json()
      // Grab all the pairs which are in USD:
      const pairs = []
      for (const entry of jsonData) {
        if (typeof entry.currency !== 'string') continue
        if (typeof entry.price !== 'string') continue
        const fromCurrency = entry.currency
        const rate = parseFloat(entry.price)
        pairs.push({
          fromCurrency,
          toCurrency: 'iso:USD',
          rate
        })
        if (DUPLICATE_RATE_MAP[fromCurrency]) {
          pairs.push({
            fromCurrency: 'iso:USD',
            toCurrency: DUPLICATE_RATE_MAP[fromCurrency],
            rate
          })
        }
      }

      return pairs
    }
  }
}
