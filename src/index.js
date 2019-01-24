// @flow

import { makeCoinbasePlugin } from './coinbase.js'
import { makeCoincapPlugin } from './coincap.js'
import { makeCurrencyconverterapiPlugin } from './currencyconverterapi.js'
import { makeHercPlugin } from './herc.js'
import { makeShapeshiftPlugin } from './shapeshift.js'

const edgeCorePlugins = {
  'shapeshift-rate': makeShapeshiftPlugin,
  coinbase: makeCoinbasePlugin,
  coincap: makeCoincapPlugin,
  currencyconverterapi: makeCurrencyconverterapiPlugin,
  herc: makeHercPlugin
}

export default edgeCorePlugins
