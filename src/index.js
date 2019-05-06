// @flow

import { makeCoinbasePlugin } from './rate/coinbase.js'
import { makeCoincapPlugin } from './rate/coincap.js'
import { makeCoincapLegacyPlugin } from './rate/coincapLegacy.js'
import { makeCurrencyconverterapiPlugin } from './rate/currencyconverterapi.js'
import { makeHercPlugin } from './rate/herc.js'
import { makeNomicsPlugin } from './rate/nomics.js'
import { makeShapeshiftRatePlugin } from './rate/shapeshift-rate.js'
import { makeChangellyPlugin } from './swap/changelly.js'
import { makeChangeNowPlugin } from './swap/changenow.js'
import { makeFaastPlugin } from './swap/faast.js'
import { makeShapeshiftPlugin } from './swap/shapeshift.js'
import { makeTotlePlugin } from './plugins/totle.js'

const edgeCorePlugins = {
  // Rate plugins:
  'shapeshift-rate': makeShapeshiftRatePlugin,
  coinbase: makeCoinbasePlugin,
  coincap: makeCoincapPlugin,
  coincapLegacy: makeCoincapLegacyPlugin,
  currencyconverterapi: makeCurrencyconverterapiPlugin,
  herc: makeHercPlugin,
  nomics: makeNomicsPlugin,

  // Swap plugins:
  changelly: makeChangellyPlugin,
  changenow: makeChangeNowPlugin,
  faast: makeFaastPlugin,
  shapeshift: makeShapeshiftPlugin,
  totle: makeTotlePlugin
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}

export default edgeCorePlugins
