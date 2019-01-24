// @flow

import { type EdgeRatePlugin, makeNodeIo } from 'edge-core-js'

import edgeCorePlugins from '../src/index.js'

const io = makeNodeIo(__dirname)

async function showRate (plugin, fromCurrency: string, toCurrency: string) {
  const instance: EdgeRatePlugin = plugin({
    initOptions: {},
    io,
    nativeIo: {},
    pluginDisklet: io.disklet
  })
  const pairs = await instance.fetchRates([])

  const name = instance.rateInfo.displayName
  for (const pair of pairs) {
    if (pair.fromCurrency === fromCurrency && pair.toCurrency === toCurrency) {
      const fromPretty = fromCurrency.replace(/iso:/, '')
      const toPretty = toCurrency.replace(/iso:/, '')
      console.log(`${name} ${fromPretty} to ${toPretty}: ${pair.rate}`)
    }
  }
}

showRate(edgeCorePlugins.coinbase, 'iso:USD', 'BTC')
showRate(edgeCorePlugins['shapeshift-rate'], 'BTC', 'ETH')
