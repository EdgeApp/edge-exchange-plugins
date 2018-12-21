export const hercPlugin = {
  pluginType: 'exchange',

  makePlugin ({ io }) {
    return Promise.resolve({
      exchangeInfo: {
        exchangeName: 'XAGAU'
      },

      async fetchExchangeRates (pairsHint) {
        const reply = await io.fetch('https://chart.anthemgold.com/service-1.0-SNAPSHOT/PRICE?symbol=HERC&range=MINUTE_5')
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