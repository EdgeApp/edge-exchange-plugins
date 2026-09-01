import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import {
  isSolanaSameChainRoute,
  makeMpTradeBasedPlugin
} from '../central/mptrade'

// The DEX half of MoonPay Trade. It carries every route MoonPay Trade settles
// on a permissionless venue, which today is Solana-to-Solana: the provider
// invokes the underlying program directly (no router of its own), no order
// state depends on user identity, and delivery is inside the user's own atomic
// transaction, so nothing server-side can gate settlement once signed. The id
// and the display name stay venue-generic so the set can grow without another
// registration. Every other route stays with the centralized `mptrade`
// registration; see the venue split documented in `central/mptrade.ts`.
export const mpTradeDefiSwapInfo: EdgeSwapInfo = {
  pluginId: 'mptradedefi',
  isDex: true,
  displayName: 'MoonPay Trade (DeFi)',
  supportEmail: 'support@edge.app'
}

export const makeMpTradeDefiPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin =>
  makeMpTradeBasedPlugin(opts, {
    swapInfo: mpTradeDefiSwapInfo,
    handlesRoute: isSolanaSameChainRoute
  })
