// @flow

import { makeChangellyPlugin } from './plugins/changelly.js'
import { makeCoinbasePlugin } from './plugins/coinbase.js'
import { makeCoincapPlugin } from './plugins/coincap.js'
import { makeCurrencyconverterapiPlugin } from './plugins/currencyconverterapi.js'
import { makeHercPlugin } from './plugins/herc.js'
import { makeShapeshiftPlugin } from './plugins/shapeshift.js'

const edgeCorePlugins = {
  'shapeshift-rate': makeShapeshiftPlugin,
  changelly: makeChangellyPlugin,
  coinbase: makeCoinbasePlugin,
  coincap: makeCoincapPlugin,
  currencyconverterapi: makeCurrencyconverterapiPlugin,
  herc: makeHercPlugin
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}

export default edgeCorePlugins
