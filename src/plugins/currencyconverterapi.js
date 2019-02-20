// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

import { getFetchJson } from '../react-native-io.js'

const checkAndPush = (isoCc, ccArray) => {
  if (isoCc !== 'iso:USD' && isoCc.slice(0, 4) === 'iso:') {
    const cc = isoCc.slice(4).toUpperCase()
    if (!ccArray.includes(cc)) {
      ccArray.push(cc)
    }
  }
}

export function makeCurrencyconverterapiPlugin (
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const fetchJson = getFetchJson(opts)

  return {
    rateInfo: {
      displayName: 'CurrencyConverterAPI'
    },

    async fetchRates (pairsHint) {
      // TODO: pairsHint is broken in Core and doesn't actually look at wallet or account
      // fiat settings. Hard code known rare currencies for now
      pairsHint = [
        { fromCurrency: 'iso:USD', toCurrency: 'iso:IMP' },
        { fromCurrency: 'iso:USD', toCurrency: 'iso:IRR' }
      ]
      const isoCodesWanted = []
      for (const pair of pairsHint) {
        checkAndPush(pair.fromCurrency, isoCodesWanted)
        checkAndPush(pair.toCurrency, isoCodesWanted)
      }

      const pairs = []
      for (const isoCode of isoCodesWanted) {
        try {
          const key = `USD_${isoCode}`
          const json = await fetchJson(
            `https://free.currencyconverterapi.com/api/v6/convert?q=${key}&compact=ultra`
          )
          if (!json || !json[key]) continue
          const rate = json[key]
          pairs.push({
            fromCurrency: 'iso:USD',
            toCurrency: `iso:${isoCode}`,
            rate
          })
        } catch (e) {
          console.log(
            `Failed to get ${isoCode} rate from currencyconverterapi.com`,
            e
          )
        }
      }
      return pairs
    }
  }
}
