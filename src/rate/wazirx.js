// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'
import currencies from 'iso4217'

type WazirXTickerResponse = {
  [pair: string]: {
    quote_unit: string,
    base_unit: string,
    last: string
  }
}

const codeTable = {}
for (const number of Object.keys(currencies)) {
  const entry = currencies[number]
  codeTable[entry.Code] = true
}

function fixCurrency(currencyCode) {
  currencyCode = currencyCode.toUpperCase()

  if (currencyCode === 'BCHABC') currencyCode = 'BCH'

  if (codeTable[currencyCode]) currencyCode = `iso:${currencyCode}`

  return currencyCode
}

export function makeWazirxPlugin(opts: EdgeCorePluginOptions): EdgeRatePlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io

  return {
    rateInfo: {
      pluginId: 'wazirx',
      displayName: 'WazirX'
    },

    async fetchRates(pairsHint) {
      const reply = await fetchCors('https://api.wazirx.com/api/v2/tickers')
      const json: WazirXTickerResponse = await reply.json()

      if (!json) return []

      // Grab all the INR pairs:
      const pairs = []
      for (const pair in json) {
        const ticker = json[pair]

        if (ticker.quote_unit !== 'inr') continue

        const rate = Number(ticker.last)
        if (rate <= 0) continue

        const fromCurrency = fixCurrency(ticker.base_unit)
        pairs.push({
          fromCurrency,
          toCurrency: 'iso:INR',
          rate
        })
      }

      return pairs
    }
  }
}
