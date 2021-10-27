// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

function fixCurrency(currencyCode) {
  return currencyCode.toUpperCase()
}

export function makeCompoundPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io
  return {
    rateInfo: {
      pluginId: 'compound',
      displayName: 'Compound'
    },

    async fetchRates(pairsHint) {
      const reply = await fetchCors(
        'https://api.compound.finance/api/v2/ctoken'
      )
      const json = await reply.json()
      if (!json || !json.cToken) return []

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
