import { asArray, asObject, asString } from 'cleaners'
import { EdgeCorePluginOptions, EdgeRatePlugin } from 'edge-core-js/types'

const asCToken = asObject({
  cToken: asArray(
    asObject({
      exchange_rate: asObject({
        value: asString
      }),
      underlying_symbol: asString,
      symbol: asString
    })
  )
})

function fixCurrency(currencyCode: string): string {
  return currencyCode.toUpperCase()
}

export function makeCompoundPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io } = opts

  return {
    rateInfo: {
      pluginId: 'compound',
      displayName: 'Compound'
    },

    async fetchRates() {
      const reply = await io.fetch('https://api.compound.finance/api/v2/ctoken')
      const json = asCToken(await reply.json())

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
