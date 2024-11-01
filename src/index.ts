import 'regenerator-runtime/runtime'

import type { EdgeCorePlugins } from 'edge-core-js/types'

import { makeChangeHeroPlugin } from './swap/central/changehero'
import { makeChangeNowPlugin } from './swap/central/changenow'
import { makeExolixPlugin } from './swap/central/exolix'
import { makeGodexPlugin } from './swap/central/godex'
import { makeLetsExchangePlugin } from './swap/central/letsexchange'
import { makeSideshiftPlugin } from './swap/central/sideshift'
import { makeSwapuzPlugin } from './swap/central/swapuz'
import { make0xGaslessPlugin } from './swap/defi/0x/0xGasless'
import { makeCosmosIbcPlugin } from './swap/defi/cosmosIbc'
import { makeLifiPlugin } from './swap/defi/lifi'
import { makeRangoPlugin } from './swap/defi/rango'
import { makeMayaProtocolPlugin } from './swap/defi/thorchain/mayaprotocol'
import { makeThorchainPlugin } from './swap/defi/thorchain/thorchain'
import { makeSwapKitPlugin } from './swap/defi/thorchain/thorchainDa'
import { makeSpookySwapPlugin } from './swap/defi/uni-v2-based/plugins/spookySwap'
import { makeTombSwapPlugin } from './swap/defi/uni-v2-based/plugins/tombSwap'
import { makeVelodromePlugin } from './swap/defi/uni-v2-based/plugins/velodrome'
import { makeTransferPlugin } from './swap/transfer'
import { xrpdex } from './swap/xrpDexInfo'

const plugins = {
  // Swap plugins:
  changehero: makeChangeHeroPlugin,
  changenow: makeChangeNowPlugin,
  cosmosibc: makeCosmosIbcPlugin,
  exolix: makeExolixPlugin,
  godex: makeGodexPlugin,
  letsexchange: makeLetsExchangePlugin,
  lifi: makeLifiPlugin,
  rango: makeRangoPlugin,
  sideshift: makeSideshiftPlugin,
  spookySwap: makeSpookySwapPlugin,
  swapuz: makeSwapuzPlugin,
  mayaprotocol: makeMayaProtocolPlugin,
  thorchain: makeThorchainPlugin,
  swapkit: makeSwapKitPlugin,
  tombSwap: makeTombSwapPlugin,
  transfer: makeTransferPlugin,
  velodrome: makeVelodromePlugin,
  xrpdex,
  '0xgasless': make0xGaslessPlugin
}

declare global {
  interface Window {
    addEdgeCorePlugins?: (plugins: EdgeCorePlugins) => void
  }
}

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(plugins)
}

export default plugins
