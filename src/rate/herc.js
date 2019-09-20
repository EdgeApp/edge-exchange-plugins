// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

export function makeHercPlugin (opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      displayName: 'XAGAU'
    },
    // crypto-to-fiat
    async fetchRates (pairsHint) {
      const reply = await io.fetch(
        'https://chart.anthemgold.com/service-1.0-SNAPSHOT/PRICE?symbol=HERCUSDVW&range=MINUTE'
      )
      const json = await reply.json()

      // Grab all the pairs which are in USD:
      return [
        {
          fromCurrency: 'HERC',
          toCurrency: 'iso:USD',
          rate: json.c
        },
        {
          fromCurrency: 'TBTC',
          toCurrency: 'iso:USD',
          rate: 0.01
        }
      ]
    }
  }
}
