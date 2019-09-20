// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const currencyCodesToInclude = [
  'FTC',
  'UFO',
  'GRS',
  'SMART',
  'IND',
  'HUR',
  'STORJ',
  'USDS',
  'GNO',
  'NEXO',
  'FUN',
  'KIN'
]

export function makeCoincapLegacyPlugin (
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      displayName: 'CoincapLegacy'
    },

    async fetchRates (pairsHint) {
      //  endpoint has been deprecated
      const reply = await io.fetch('https://coincap.io/front')
      const json = await reply.json()

      // Grab all the pairs which are in USD:
      const pairs = []
      for (const entry of json) {
        if (typeof entry.short !== 'string') continue
        if (typeof entry.price !== 'number') continue
        const currency = entry.short
        if (!currencyCodesToInclude.includes(currency)) continue
        pairs.push({
          fromCurrency: currency,
          toCurrency: 'iso:USD',
          rate: entry.price
        })
      }

      return pairs
    }
  }
}
