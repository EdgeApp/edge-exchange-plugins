// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const targetCurrencyCodes = {
  HERCUSDV: 'HERC',
  USDAGLD: 'AGLD'
}

export function makeXagauPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      displayName: 'Xagau'
    },

    async fetchRates(pairsHint) {
      const reply = await io.fetch(
        'https://chart.anthemgold.com/service-1.0-SNAPSHOT/MULTIPRICE?'
      )
      const json = await reply.json()

      // Grab all the pairs which are in USD:
      const pairs = []
      for (const entry of json) {
        if (typeof entry.symbol !== 'string') continue
        if (typeof entry.c !== 'string') continue
        if (targetCurrencyCodes[entry.symbol]) {
          const fromCurrency = targetCurrencyCodes[entry.symbol]
          const rate = parseFloat(entry.c)
          pairs.push({
            fromCurrency,
            toCurrency: 'iso:USD',
            rate
          })
        }
      }
      return pairs
    }
  }
}
