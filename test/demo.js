import { makeNodeIo } from 'airbitz-io-node-js'
import assert from 'assert'

const io = makeNodeIo(__dirname)

const { coinbasePlugin } = require('../lib')

async function showRate (plugin, fromCurrency, toCurrency) {
  assert.equal(plugin.pluginType, 'exchange')
  const instance = await plugin.makePlugin(io)
  const pairs = await instance.fetchExchangeRates([])

  const name = instance.exchangeInfo.exchangeName
  for (const pair of pairs) {
    if (pair.fromCurrency === fromCurrency && pair.toCurrency === toCurrency) {
      const fromPretty = fromCurrency.replace(/iso:/, '')
      const toPretty = toCurrency.replace(/iso:/, '')
      console.log(`${name} ${fromPretty} to ${toPretty}: ${pair.rate}`)
    }
  }
}

showRate(coinbasePlugin, 'BTC', 'iso:USD')
