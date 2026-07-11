/**
 * NYM Exchange Plugin Chain Mapping
 *
 * Maps EdgeCurrencyPluginId -> NYM `chainNetwork` identifier (or null when the
 * chain is not offered by NYM).
 *
 * NYM exposes an "Edge Partner API" whose asset references mirror Edge's own
 * model: a `chainNetwork` string, an optional EVM `chainId`, and an optional
 * `tokenId` (the 0x contract address). `chainNetwork` is the network *family*
 * name; for EVM chains the `chainId` (taken from the wallet's `evmChainId` at
 * quote time) distinguishes one EVM network from another. On the livenet API,
 * Ethereum mainnet is `chainNetwork: 'ethereum'` + `chainId: 1`, which is why
 * the Edge `ethereum` pluginId maps to `'ethereum'` below; the same entry also
 * covers Ethereum tokens (USDT, USDC, ERC-20 NYM) via the wallet's contract
 * address supplied at quote time.
 *
 * Every NYM swap must have the NYM asset (native NYM on `chainNetwork: 'nyx'`,
 * Edge pluginId `nym`) on one side; this is enforced in ../swap/central/nym.ts.
 *
 * The authoritative list of supported assets is `GET /api/partner/v1/currencies`;
 * the entries below reflect the current livenet list (BTC, Ethereum ETH/USDT/USDC
 * /ERC-20 NYM, native NYM). Add more chains here as NYM enables them on livenet.
 *
 * See https://nym-swap-api.nymtech.cc/api/docs/ for the API docs.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const nym = new Map<EdgeCurrencyPluginId, string | null>()
nym.set('bitcoin', 'bitcoin')
// Ethereum mainnet; chainId 1 is supplied from the wallet's evmChainId at quote
// time. Also covers Ethereum tokens (USDT, USDC, ERC-20 NYM) via their tokenId.
nym.set('ethereum', 'ethereum')
// The NYM asset itself: native NYM on the Nyx chain.
nym.set('nym', 'nyx')
