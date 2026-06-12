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
 * quote time) distinguishes mainnet from testnet. On the current testnet API,
 * Sepolia is therefore `chainNetwork: 'ethereum'` + `chainId: 11155111`, which
 * is why the Edge `sepolia` pluginId maps to `'ethereum'` below.
 *
 * Every NYM swap must have the NYM asset (`chainNetwork: 'sandbox'`, Edge
 * pluginId `nym`) on one side; this is enforced in ../swap/central/nym.ts.
 *
 * NYM is testnet-only for now. The authoritative list of supported assets is
 * `GET /api/partner/v1/currencies`; the entries below reflect that testnet list
 * (BTC, LTC, ZEC, DASH, Sepolia ETH/USDC, ADA, NYM) and should be expanded
 * (including mainnet `ethereum` with chainId 1) when NYM launches mainnet.
 *
 * See https://nym-swap-testnet-api.nymte.ch/api/docs/ for the API docs.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const nym = new Map<EdgeCurrencyPluginId, string | null>()
nym.set('bitcoin', 'bitcoin')
nym.set('cardano', 'cardano')
nym.set('dash', 'dash')
nym.set('litecoin', 'litecoin')
// The NYM asset itself (testnet "sandbox" network).
nym.set('nym', 'sandbox')
// Sepolia is the only EVM testnet NYM supports; chainId 11155111 is supplied
// from the wallet's evmChainId at quote time.
nym.set('sepolia', 'ethereum')
nym.set('zcash', 'zcash')
