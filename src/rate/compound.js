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

function fixCurrency (currencyCode) {
  currencyCode = currencyCode.toUpperCase()

  return codeTable[currencyCode] ? 'iso:' + currencyCode : currencyCode
}

export function makeCompoundPlugin (
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      displayName: 'Compound'
    },

    async fetchRates (pairsHint) {
      const reply = await io.fetch('https://api.compound.finance/api/v2/ctoken')
      const json = await reply.json()
      if (!json || !json.cToken) return []

      // Grab all the USD pairs:
      const pairs = []
      for (const rateInfo of json.cToken) {
        const rate = Number(rateInfo.exchange_rate.value)
        const toCurrency = fixCurrency(rateInfo.underlying_symbol)
        const fromCurrency = fixCurrency(rateInfo.symbol)
        pairs.push({
          fromCurrency,
          toCurrency,
          rate
        })
      }

      return pairs
    }
  }
}
