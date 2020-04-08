// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'
import currencies from 'iso4217'

const codeTable = {}
for (const number of Object.keys(currencies)) {
  const entry = currencies[number]
  codeTable[entry.Code] = true
}

function fixCurrency(currencyCode) {
  currencyCode = currencyCode.toUpperCase()

  return codeTable[currencyCode] ? 'iso:' + currencyCode : currencyCode
}

export function makeCoinbasePlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      pluginId: 'coinbase',
      displayName: 'Coinbase'
    },

    async fetchRates(pairsHint) {
      const reply = await io.fetch('https://api.coinbase.com/v2/exchange-rates')
      const json = await reply.json()

      if (!json || !json.data || !json.data.rates) return []

      // Grab all the USD pairs:
      const pairs = []
      const keys = Object.keys(json.data.rates)
      for (const key of keys) {
        const rate = Number(json.data.rates[key])
        const toCurrency = fixCurrency(key)
        pairs.push({
          fromCurrency: 'iso:USD',
          toCurrency,
          rate
        })
      }

      return pairs
    }
  }
}
