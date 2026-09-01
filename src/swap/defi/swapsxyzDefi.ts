import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import {
  isSolanaSameChainRoute,
  makeSwapsXyzBasedPlugin
} from '../central/swapsxyz'

// The DEX half of swaps.xyz. It carries every route swaps.xyz settles on a
// permissionless venue, which today is Solana-to-Solana: the provider invokes
// the underlying program directly (no router of its own), no order state
// depends on user identity, and delivery is inside the user's own atomic
// transaction, so nothing server-side can gate settlement once signed. The id
// and the display name stay venue-generic so the set can grow without another
// registration. Every other route stays with the centralized `swapsxyz`
// registration; see the venue split documented in `central/swapsxyz.ts`.
export const swapsXyzDefiSwapInfo: EdgeSwapInfo = {
  pluginId: 'swapsxyzdefi',
  isDex: true,
  displayName: 'MoonPay Trade (DeFi)',
  supportEmail: 'support@edge.app'
}

export const makeSwapsXyzDefiPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin =>
  makeSwapsXyzBasedPlugin(opts, {
    swapInfo: swapsXyzDefiSwapInfo,
    handlesRoute: isSolanaSameChainRoute
  })
