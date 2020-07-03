// @flow

import { makeCoinbasePlugin } from './rate/coinbase.js'
import { makeCoincapPlugin } from './rate/coincap.js'
import { makeCoinmonitorPlugin } from './rate/coinmonitor.js'
import { makeCompoundPlugin } from './rate/compound.js'
import { makeConstantRatePlugin } from './rate/constantRate.js'
import { makeCurrencyconverterapiPlugin } from './rate/currencyconverterapi.js'
import { makeNomicsPlugin } from './rate/nomics.js'
import { makeWazirxPlugin } from './rate/wazirx'
import { makeXagauPlugin } from './rate/xagau.js'
import { makeChangellyPlugin } from './swap/changelly.js'
import { makeChangeNowPlugin } from './swap/changenow.js'
import { makeCoinSwitchPlugin } from './swap/coinswitch.js'
import { makeFaastPlugin } from './swap/faast.js'
import { makeFoxExchangePlugin } from './swap/foxExchange.js'
import { makeGodexPlugin } from './swap/godex.js'
import { makeShapeshiftPlugin } from './swap/shapeshift.js'
import { makeSwitchainPlugin } from './swap/switchain.js'
import { makeTotlePlugin } from './swap/totle.js'
import { makeTransferPlugin } from './swap/transfer.js'

const edgeCorePlugins = {
  // Rate plugins:
  coinbase: makeCoinbasePlugin,
  coincap: makeCoincapPlugin,
  coinmonitor: makeCoinmonitorPlugin,
  compound: makeCompoundPlugin,
  constantRate: makeConstantRatePlugin,
  currencyconverterapi: makeCurrencyconverterapiPlugin,
  nomics: makeNomicsPlugin,
  xagau: makeXagauPlugin,
  wazirx: makeWazirxPlugin,

  // Swap plugins:
  changelly: makeChangellyPlugin,
  changenow: makeChangeNowPlugin,
  coinswitch: makeCoinSwitchPlugin,
  faast: makeFaastPlugin,
  foxExchange: makeFoxExchangePlugin,
  godex: makeGodexPlugin,
  shapeshift: makeShapeshiftPlugin,
  switchain: makeSwitchainPlugin,
  totle: makeTotlePlugin,
  transfer: makeTransferPlugin
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}

export default edgeCorePlugins
