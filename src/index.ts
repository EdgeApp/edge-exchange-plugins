import { makeBitMaxPlugin } from './rate/bitmax'
import { makeCoinbasePlugin } from './rate/coinbase'
import { makeCoincapPlugin } from './rate/coincap'
import { makeCoinGeckoPlugin } from './rate/coingecko'
import { makeCoinmonitorPlugin } from './rate/coinmonitor'
import { makeCompoundPlugin } from './rate/compound'
import { makeConstantRatePlugin } from './rate/constantRate'
import { makeCurrencyconverterapiPlugin } from './rate/currencyconverterapi'
import { makeEdgeRatesPlugin } from './rate/edgeRates'
import { makeNomicsPlugin } from './rate/nomics'
import { makeWazirxPlugin } from './rate/wazirx'
import { makeChangeHeroPlugin } from './swap/changehero'
import { makeChangeNowPlugin } from './swap/changenow'
import { makeThorchainPlugin } from './swap/defi/thorchain'
import { makeSpookySwapPlugin } from './swap/defi/uni-v2-based/plugins/spookySwap'
import { makeTombSwapPlugin } from './swap/defi/uni-v2-based/plugins/tombSwap'
import { makeExolixPlugin } from './swap/exolix'
import { makeFoxExchangePlugin } from './swap/foxExchange'
import { makeGodexPlugin } from './swap/godex'
import { makeLetsExchangePlugin } from './swap/letsexchange'
import { makeSideshiftPlugin } from './swap/sideshift'
import { makeSwapuzPlugin } from './swap/swapuz'
import { makeSwitchainPlugin } from './swap/switchain'
import { makeTransferPlugin } from './swap/transfer'

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
  swapuz: makeSwapuzPlugin,
  switchain: makeSwitchainPlugin,
  thorchain: makeThorchainPlugin,
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
