import 'regenerator-runtime/runtime'

import type { EdgeCorePlugins } from 'edge-core-js/types'

import { makeChangeHeroPlugin } from './swap/changehero'
import { makeChangeNowPlugin } from './swap/changenow'
import { makeLifiPlugin } from './swap/defi/lifi'
import { makeThorchainPlugin } from './swap/defi/thorchain'
import { makeThorchainDaPlugin } from './swap/defi/thorchainDa'
import { makeSpookySwapPlugin } from './swap/defi/uni-v2-based/plugins/spookySwap'
import { makeTombSwapPlugin } from './swap/defi/uni-v2-based/plugins/tombSwap'
import { makeVelodromePlugin } from './swap/defi/uni-v2-based/plugins/velodrome'
import { makeXrpDexPlugin } from './swap/defi/xrpDex'
import { makeExolixPlugin } from './swap/exolix'
import { makeGodexPlugin } from './swap/godex'
import { makeLetsExchangePlugin } from './swap/letsexchange'
import { makeSideshiftPlugin } from './swap/sideshift'
import { makeSwapuzPlugin } from './swap/swapuz'
import { makeTransferPlugin } from './swap/transfer'

const plugins = {
  // Swap plugins:
  changehero: makeChangeHeroPlugin,
  changenow: makeChangeNowPlugin,
  exolix: makeExolixPlugin,
  godex: makeGodexPlugin,
  letsexchange: makeLetsExchangePlugin,
  lifi: makeLifiPlugin,
  sideshift: makeSideshiftPlugin,
  spookySwap: makeSpookySwapPlugin,
  swapuz: makeSwapuzPlugin,
  thorchain: makeThorchainPlugin,
  thorchainda: makeThorchainDaPlugin,
  tombSwap: makeTombSwapPlugin,
  transfer: makeTransferPlugin,
  velodrome: makeVelodromePlugin,
  xrpdex: makeXrpDexPlugin
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
