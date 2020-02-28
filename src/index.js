// @flow

import { makeCoinbasePlugin } from './rate/coinbase.js'
import { makeCoincapPlugin } from './rate/coincap.js'
import { makeCompoundPlugin } from './rate/compound.js'
import { makeConstantRatePlugin } from './rate/constantRate.js'
import { makeCurrencyconverterapiPlugin } from './rate/currencyconverterapi.js'
import { makeNomicsPlugin } from './rate/nomics.js'
import { makeXagauPlugin } from './rate/xagau.js'
import { makeChangellyPlugin } from './swap/changelly.js'
import { makeSideShiftPlugin } from './swap/sideshift'
import { makeChangeNowPlugin } from './swap/changenow.js'
import { makeCoinSwitchPlugin } from './swap/coinswitch.js'
import { makeFaastPlugin } from './swap/faast.js'
import { makeFoxExchangePlugin } from './swap/foxExchange.js'
import { makeGodexPlugin } from './swap/godex.js'
import { makeShapeshiftPlugin } from './swap/shapeshift.js'
import { makeSwitchainPlugin } from './swap/switchain.js'
import { makeTotlePlugin } from './swap/totle.js'

const edgeCorePlugins = {
  // Rate plugins:
  coinbase: makeCoinbasePlugin,
  coincap: makeCoincapPlugin,
  compound: makeCompoundPlugin,
  constantRate: makeConstantRatePlugin,
  currencyconverterapi: makeCurrencyconverterapiPlugin,
  nomics: makeNomicsPlugin,
  xagau: makeXagauPlugin,

  // Swap plugins:
  changelly: makeChangellyPlugin,
  sideshift: makeSideShiftPlugin,
  changenow: makeChangeNowPlugin,
  coinswitch: makeCoinSwitchPlugin,
  faast: makeFaastPlugin,
  foxExchange: makeFoxExchangePlugin,
  godex: makeGodexPlugin,
  shapeshift: makeShapeshiftPlugin,
  switchain: makeSwitchainPlugin,
  totle: makeTotlePlugin
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}

export default edgeCorePlugins
