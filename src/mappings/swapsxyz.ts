/**
 * swaps.xyz Exchange Plugin Chain Mapping
 *
 * Maps EdgeCurrencyPluginId -> swaps.xyz numeric `chainId` (as a string) or
 * null when the chain can never be offered.
 *
 * swaps.xyz (a MoonPay product) is a cross-chain DEX/bridge aggregator whose
 * REST API identifies every network by the EVM numeric chain id. That id is a
 * property of the CHAIN, not of swaps.xyz's support for it, so every EVM
 * network `edge-currency-accountbased` ships is listed here with its real id,
 * whether or not swaps.xyz routes it today: when they add one, it works with
 * no code change. Live support is decided per quote by `GET /getPaths`, which
 * answers HTTP 200 with an empty `paths` array for a pair it cannot route
 * (see ../swap/defi/swapsxyz.ts).
 *
 * Testnets and dev chains are null: swaps.xyz is mainnet-only, so mapping them
 * would only buy a network round trip before the same rejection.
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

export const swapsxyz = new Map<EdgeCurrencyPluginId, string | null>()
swapsxyz.set('abstract', '2741')
swapsxyz.set('amoy', null) // Polygon testnet
swapsxyz.set('arbitrum', '42161')
swapsxyz.set('avalanche', '43114')
swapsxyz.set('base', '8453')
swapsxyz.set('binancesmartchain', '56')
swapsxyz.set('bobevm', '60808')
swapsxyz.set('botanix', '3637')
swapsxyz.set('celo', '42220')
swapsxyz.set('ethDev', null) // Local dev chain
swapsxyz.set('ethereum', '1')
swapsxyz.set('ethereumclassic', '61')
swapsxyz.set('ethereumpow', '10001')
swapsxyz.set('fantom', '250')
swapsxyz.set('filecoinfevm', '314')
swapsxyz.set('filecoinfevmcalibration', null) // Filecoin testnet
swapsxyz.set('holesky', null) // Ethereum testnet
swapsxyz.set('hyperevm', '999')
swapsxyz.set('monad', '143')
swapsxyz.set('opbnb', '204')
swapsxyz.set('optimism', '10')
swapsxyz.set('polygon', '137')
swapsxyz.set('pulsechain', '369')
swapsxyz.set('rsk', '30')
swapsxyz.set('sepolia', null) // Ethereum testnet
swapsxyz.set('sonic', '146')
swapsxyz.set('zksync', '324')
