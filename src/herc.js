export const hercPlugin = {
  pluginType: 'exchange',

  makePlugin ({ io }) {
    return Promise.resolve({
      exchangeInfo: {
        exchangeName: 'XAGAU'
      },

      async fetchExchangeRates (pairsHint) {
        const reply = await io.fetch('https://chart.anthemgold.com/service-1.0-SNAPSHOT/PRICE?symbol=HERCUSDV&range=MINUTE')
        const json = await reply.json()

        // Grab all the pairs which are in USD:
        const pairs = []
        pairs.push({
          fromCurrency: 'iso:USD',
          toCurrency: 'HERC',
          rate: json.c
        })

        return pairs
      }
    })
  }
}
