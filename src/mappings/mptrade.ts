/**
 * MoonPay Trade Exchange Plugin Chain Mapping
 *
 * Maps EdgeCurrencyPluginId -> MoonPay Trade numeric `chainId` (as a string) or
 * null when the chain can never be offered.
 *
 * MoonPay Trade is a cross-chain DEX/bridge aggregator whose
 * REST API identifies every network by the EVM numeric chain id. That id is a
 * property of the CHAIN, not of MoonPay Trade's support for it, so every EVM
 * network `edge-currency-accountbased` ships is listed here with its real id,
 * whether or not MoonPay Trade routes it today: when they add one, it works
 * with no code change. Live support is decided per quote by `GET /getPaths`,
 * which answers HTTP 200 with an empty `paths` array for a pair it cannot route
 * (see ../swap/defi/mptrade.ts).
 *
 * Testnets and dev chains are null: MoonPay Trade is mainnet-only, so mapping
 * them would only buy a network round trip before the same rejection.
 *
 * Non-EVM chains are absent entirely. `getAction` only returns directly
 * executable calldata for networks whose `vmId` is `evm`, and this plugin
 * executes nothing else.
 *
 * The value is the decimal chain id as a string; it is parsed back to a number
 * for the `srcChainId`/`dstChainId` query params.
 *
 * See https://docs.swaps.xyz/ for the API docs.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const mptrade = new Map<EdgeCurrencyPluginId, string | null>()
mptrade.set('abstract', '2741')
mptrade.set('amoy', null) // Polygon testnet
mptrade.set('arbitrum', '42161')
mptrade.set('avalanche', '43114')
mptrade.set('base', '8453')
mptrade.set('binancesmartchain', '56')
mptrade.set('bobevm', '60808')
mptrade.set('botanix', '3637')
mptrade.set('celo', '42220')
mptrade.set('ethDev', null) // Local dev chain
mptrade.set('ethereum', '1')
mptrade.set('ethereumclassic', '61')
mptrade.set('ethereumpow', '10001')
mptrade.set('fantom', '250')
mptrade.set('filecoinfevm', '314')
mptrade.set('filecoinfevmcalibration', null) // Filecoin testnet
mptrade.set('holesky', null) // Ethereum testnet
mptrade.set('hyperevm', '999')
mptrade.set('monad', '143')
mptrade.set('opbnb', '204')
mptrade.set('optimism', '10')
mptrade.set('polygon', '137')
mptrade.set('pulsechain', '369')
mptrade.set('rsk', '30')
mptrade.set('sepolia', null) // Ethereum testnet
mptrade.set('sonic', '146')
mptrade.set('zksync', '324')
