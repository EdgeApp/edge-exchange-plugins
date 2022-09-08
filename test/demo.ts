/* eslint-disable no-console */

import { EdgeCorePluginOptions, EdgeRatePlugin, makeNodeIo } from 'edge-core-js'

import edgeCorePlugins from '../src/index'

type EdgeRatePluginFactory = (env: EdgeCorePluginOptions) => EdgeRatePlugin

const io = makeNodeIo(__dirname)
const log = Object.assign(() => {}, {
  error() {},
  warn() {},
  crash() {},
  breadcrumb() {}
})

async function showRate(
  plugin: EdgeRatePluginFactory,
  fromCurrency: string,
  toCurrency: string,
  initOptions: Object = {}
): Promise<void> {
  const instance: EdgeRatePlugin = plugin({
    initOptions,
    io,
    log,
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

showRate(edgeCorePlugins.coinbase, 'iso:USD', 'BTC').catch(e => console.log(e))

// Uncomment and insert key to test:
// showRate(edgeCorePlugins['currencyconverterapi'], 'iso:USD', 'iso:IRR', {
//   apiKey: 'xxxx'
// })
