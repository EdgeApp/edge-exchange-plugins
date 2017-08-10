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

export const coinbasePlugin = {
  pluginType: 'exchange',

  makePlugin ({ io }) {
    return Promise.resolve({
      exchangeInfo: {
        exchangeName: 'Coinbase'
      },

      async fetchExchangeRates (pairsHint) {
        const reply = await io.fetch(
          'https://coinbase.com/api/v1/currencies/exchange_rates'
        )
        const json = await reply.json()

        // Grab all the BTC pairs:
        const pairs = []
        const keys = Object.keys(json)
        for (const key of keys) {
          const currency = key.replace(/btc_to_/, '')
          if (currency === key) continue

          pairs.push({
            fromCurrency: 'BTC',
            toCurrency: fixCurrency(currency),
            rate: json[key]
          })
        }

        return pairs
      }
    })
  }
}
