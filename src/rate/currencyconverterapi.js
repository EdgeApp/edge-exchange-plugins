// @flow

import { asMap, asNumber } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asCurrencyConverterResponse = asMap(asNumber)

const checkAndPush = (isoCc, ccArray) => {
  if (isoCc !== 'iso:USD' && isoCc.slice(0, 4) === 'iso:') {
    const cc = isoCc.slice(4).toUpperCase()
    if (!ccArray.includes(`USD_${cc}`)) {
      ccArray.push(`USD_${cc}`)
    }
  }
}

export function makeCurrencyconverterapiPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io

  const { apiKey } = opts.initOptions
  if (apiKey == null) {
    throw new Error('No currencyconverterapi apiKey provided')
  }

  return {
    rateInfo: {
      pluginId: 'currencyconverterapi',
      displayName: 'CurrencyConverterAPI'
    },

    async fetchRates(pairsHint) {
      pairsHint = pairsHint.concat([
        { fromCurrency: 'iso:USD', toCurrency: 'iso:IMP' },
        { fromCurrency: 'iso:USD', toCurrency: 'iso:IRR' }
      ])
      const isoCodesWanted = []
      for (const pair of pairsHint) {
        checkAndPush(pair.fromCurrency, isoCodesWanted)
        checkAndPush(pair.toCurrency, isoCodesWanted)
      }

      const pairs = []
      const query = isoCodesWanted.join(',')
      try {
        const response = await fetchCors(
          `https://api.currconv.com/api/v7/convert?q=${query}&compact=ultra&apiKey=${apiKey}`
        )
        const responseJson = asCurrencyConverterResponse(await response.json())
        for (const rate of Object.keys(responseJson)) {
          pairs.push({
            fromCurrency: 'iso:USD',
            toCurrency: `iso:${rate.split('_')[1]}`,
            rate: responseJson[rate]
          })
        }
      } catch (e) {
        log.warn(`Failed to get ${query} from currencyconverterapi.com`, e)
      }
      return pairs
    }
  }
}
