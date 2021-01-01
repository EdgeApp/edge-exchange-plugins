// @flow

import { asMap, asNumber, asObject } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asGeckoUsdReply = asObject({
  market_data: asObject({
    current_price: asMap(asNumber)
  })
})

const coinGeckoMap = {
  TLOS: 'telos',
  FIRO: 'zcoin',
  ANT: 'aragon',
  AYFI: 'ayfi',
  ALINK: 'aave-link',
  ADAI: 'aave-dai',
  ABAT: 'aave-bat',
  AETH: 'aave-eth',
  AWBTC: 'aave-wbtc',
  ASNX: 'aave-snx',
  AREN: 'aave-ren',
  AUSDT: 'aave-usdt',
  AMKR: 'aave-mkr',
  AMANA: 'aave-mana',
  AZRX: 'aave-zrx',
  AKNC: 'aave-knc',
  AUSDC: 'aave-usdc',
  ASUSD: 'aave-susd'
}

export function makeCoinGeckoPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts

  return {
    rateInfo: {
      displayName: 'Coingecko',
      pluginId: 'coingecko'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      let rates
      for (const pair of pairsHint) {
        // Coingecko is only used to query specific currencies
        if (coinGeckoMap[pair.fromCurrency] == null) continue
        try {
          if (rates === undefined) {
            const reply = await io.fetch(
              `https://api.coingecko.com/api/v3/coins/${
                coinGeckoMap[pair.fromCurrency]
              }?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
            )
            const json = await reply.json()
            rates = asGeckoUsdReply(json)
          }
          const fiatCode = pair.toCurrency.split(':')
          let toCurrency
          let rate
          if (
            rates.market_data.current_price[fiatCode[1].toLowerCase()] != null
          ) {
            toCurrency = pair.toCurrency
            rate = rates.market_data.current_price[fiatCode[1].toLowerCase()]
          } else {
            // Save BTC value if requested fiat isn't provided
            toCurrency = 'BTC'
            rate = rates.market_data.current_price.btc
          }
          pairs.push({
            fromCurrency: pair.fromCurrency,
            toCurrency,
            rate
          })
          if (pair.fromCurrency === 'ANT') {
            pairs.push({
              fromCurrency: 'ANTV1',
              toCurrency,
              rate
            })
          }
        } catch (e) {
          log(`Issue with Coingecko rate data structure ${e}`)
        }
      }
      return pairs
    }
  }
}
