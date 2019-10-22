// @flow

import { makeCoinbasePlugin } from './rate/coinbase.js'
import { makeCoincapPlugin } from './rate/coincap.js'
import { makeCompoundPlugin } from './rate/compound.js'
import { makeConstantRatePlugin } from './rate/constantRate.js'
import { makeCurrencyconverterapiPlugin } from './rate/currencyconverterapi.js'
import { makeNomicsPlugin } from './rate/nomics.js'
import { makeXagauPlugin } from './rate/xagau.js'
import { makeChangellyPlugin } from './swap/changelly.js'
import { makeChangeNowPlugin } from './swap/changenow.js'
import { makeCoinSwitchPlugin } from './swap/coinswitch.js'
import { makeFaastPlugin } from './swap/faast.js'
import { makeFoxExchangePlugin } from './swap/foxExchange.js'
import { makeGodexPlugin } from './swap/godex.js'
import { makeShapeshiftPlugin } from './swap/shapeshift.js'
import { makeTotlePlugin } from './swap/totle.js'

const edgeCorePlugins = {
  // Rate plugins:
  coinbase: makeCoinbasePlugin,
  coincap: makeCoincapPlugin,
  currencyconverterapi: makeCurrencyconverterapiPlugin,
  xagau: makeXagauPlugin,
  nomics: makeNomicsPlugin,
  constantRate: makeConstantRatePlugin,
  compound: makeCompoundPlugin,

  // Swap plugins:
  changelly: makeChangellyPlugin,
  changenow: makeChangeNowPlugin,
  faast: makeFaastPlugin,
  shapeshift: makeShapeshiftPlugin,
  totle: makeTotlePlugin,
  foxExchange: makeFoxExchangePlugin,
  godex: makeGodexPlugin,
  coinswitch: makeCoinSwitchPlugin
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}

export default edgeCorePlugins
