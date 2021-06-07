// @flow

import { makeCoinGeckoPlugin } from './rate/coingecko.js'
import { makeEdgeRatesPlugin } from './rate/edgeRates.js'
import { makeChangellyPlugin } from './swap/changelly.js'
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
  coingecko: makeCoinGeckoPlugin,
  edgeRates: makeEdgeRatesPlugin,

  // Swap plugins:
  changelly: makeChangellyPlugin,
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
