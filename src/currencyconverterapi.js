// @flow

import { type EdgeExchangePluginFactory } from 'edge-core-js/types'

const checkAndPush = (isoCc, ccArray) => {
  if (isoCc !== 'iso:USD' && isoCc.slice(0, 4) === 'iso:') {
    const cc = isoCc.slice(4).toUpperCase()
    if (!ccArray.includes(cc)) {
      ccArray.push(cc)
    }
  }
}

export const currencyconverterapiPlugin: EdgeExchangePluginFactory = {
  pluginType: 'exchange',

  makePlugin ({ io }) {
    return Promise.resolve({
      exchangeInfo: {
        exchangeName: 'CurrencyConverterAPI'
      },

      async fetchExchangeRates (pairsHint) {
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
            const reply = await io.fetch(
              `https://free.currencyconverterapi.com/api/v6/convert?q=${key}&compact=ultra`
            )
            const json = await reply.json()
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
    })
  }
}
