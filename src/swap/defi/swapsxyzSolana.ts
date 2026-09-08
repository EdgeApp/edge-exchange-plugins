import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import {
  isSolanaSameChainRoute,
  makeSwapsXyzBasedPlugin
} from '../central/swapsxyz'

// The DEX half of swaps.xyz: Solana-to-Solana routes only. The provider
// invokes the underlying Solana program directly (no router of its own), no
// order state depends on user identity, and delivery is inside the user's own
// atomic transaction, so nothing server-side can gate settlement once signed.
// Every other swaps.xyz route stays with the centralized `swapsxyz`
// registration; see the venue split documented in `central/swapsxyz.ts`.
export const swapsXyzSolanaSwapInfo: EdgeSwapInfo = {
  pluginId: 'swapsxyzsolana',
  isDex: true,
  displayName: 'MoonPay Trade (DeFi)',
  supportEmail: 'support@edge.app'
}

export const makeSwapsXyzSolanaPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin =>
  makeSwapsXyzBasedPlugin(opts, {
    swapInfo: swapsXyzSolanaSwapInfo,
    handlesRoute: isSolanaSameChainRoute
  })
