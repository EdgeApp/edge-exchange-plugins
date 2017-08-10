export const shapeshiftPlugin = {
  pluginType: 'exchange',

  makePlugin ({ io }) {
    return Promise.resolve({
      exchangeInfo: {
        exchangeName: 'Shapeshift'
      },

      async fetchExchangeRates (pairsHint) {
        const reply = await io.fetch('https://shapeshift.io/marketinfo/')
        const json = await reply.json()

        // Grab all the BTC pairs:
        const pairs = []
        for (const entry of json) {
          const currency = entry.pair.replace(/BTC_/, '')
          if (currency === entry.pair) continue

          pairs.push({
            fromCurrency: 'BTC',
            toCurrency: currency,
            rate: entry.rate
          })
        }

        return pairs
      }
    })
  }
}
