export const coincapPlugin = {
  pluginType: 'exchange',

  makePlugin ({ io }) {
    return Promise.resolve({
      exchangeInfo: {
        exchangeName: 'Coincap'
      },

      async fetchExchangeRates (pairsHint) {
        const reply = await io.fetch('https://coincap.io/front')
        const json = await reply.json()

        // Grab all the pairs which are in USD:
        const pairs = []
        for (const entry of json) {
          if (typeof entry.short !== 'string') continue
          if (typeof entry.price !== 'number') continue
          const currency = entry.short

          pairs.push({
            fromCurrency: currency,
            toCurrency: 'iso:USD',
            rate: entry.price
          })
        }

        return pairs
      }
    })
  }
}
