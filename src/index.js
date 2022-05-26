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
import { makeChangeHeroPlugin } from './swap/changehero.js'
import { makeChangeNowPlugin } from './swap/changenow.js'
import { makeSpookySwapPlugin } from './swap/defi/uni-v2-based/plugins/spookySwap.js'
import { makeTombSwapPlugin } from './swap/defi/uni-v2-based/plugins/tombSwap.js'
import { makeExolixPlugin } from './swap/exolix.js'
import { makeFoxExchangePlugin } from './swap/foxExchange.js'
import { makeGodexPlugin } from './swap/godex.js'
import { makeLetsExchangePlugin } from './swap/letsexchange.js'
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
  changehero: makeChangeHeroPlugin,
  changenow: makeChangeNowPlugin,
  exolix: makeExolixPlugin,
  foxExchange: makeFoxExchangePlugin,
  godex: makeGodexPlugin,
  sideshift: makeSideshiftPlugin,
  spookySwap: makeSpookySwapPlugin,
  tombSwap: makeTombSwapPlugin,
  switchain: makeSwitchainPlugin,
  transfer: makeTransferPlugin,
  letsexchange: makeLetsExchangePlugin
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}

export default edgeCorePlugins
