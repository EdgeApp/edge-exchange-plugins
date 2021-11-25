// @flow

import { makeBitMaxPlugin } from './rate/bitmax.js'
import { makeCoinbasePlugin } from './rate/coinbase.js'
import { makeCoincapPlugin } from './rate/coincap.js'
import { makeCoinGeckoPlugin } from './rate/coingecko.js'
import { makeCoinmonitorPlugin } from './rate/coinmonitor.js'
import { makeCompoundPlugin } from './rate/compound.js'
import { makeConstantRatePlugin } from './rate/constantRate.js'
import { makeCurrencyconverterapiPlugin } from './rate/currencyconverterapi.js'
import { makeEdgeRatesPlugin } from './rate/edgeRates.js'
import { makeNomicsPlugin } from './rate/nomics.js'
import { makeWazirxPlugin } from './rate/wazirx'
import { makeChangellyPlugin } from './swap/changelly.js'
import { makeChangeNowPlugin } from './swap/changenow.js'
import { makeFoxExchangePlugin } from './swap/foxExchange.js'
import { makeGodexPlugin } from './swap/godex.js'
import { makeSideshiftPlugin } from './swap/sideshift.js'
import { makeSwitchainPlugin } from './swap/switchain.js'
import { makeTransferPlugin } from './swap/transfer.js'

const edgeCorePlugins = {
  // Rate plugins:
  bitmax: makeBitMaxPlugin,
  coinbase: makeCoinbasePlugin,
  coincap: makeCoincapPlugin,
  coingecko: makeCoinGeckoPlugin,
  coinmonitor: makeCoinmonitorPlugin,
  compound: makeCompoundPlugin,
  constantRate: makeConstantRatePlugin,
  currencyconverterapi: makeCurrencyconverterapiPlugin,
  edgeRates: makeEdgeRatesPlugin,
  nomics: makeNomicsPlugin,
  wazirx: makeWazirxPlugin,

  // Swap plugins:
  changelly: makeChangellyPlugin,
  changenow: makeChangeNowPlugin,
  foxExchange: makeFoxExchangePlugin,
  godex: makeGodexPlugin,
  sideshift: makeSideshiftPlugin,
  switchain: makeSwitchainPlugin,
  transfer: makeTransferPlugin
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}

export default edgeCorePlugins
