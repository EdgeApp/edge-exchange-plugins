/**
 * MoonPay Trade Exchange Plugin Chain Mapping
 *
 * Maps EdgeCurrencyPluginId -> MoonPay Trade numeric `chainId` (as a string) or
 * null when the chain can never be offered.
 *
 * MoonPay Trade is a cross-chain swap aggregator whose REST API
 * identifies every network by a numeric chain id: the real EVM chain id where
 * one exists, and a synthetic id in the 999000xxx range for the chains that
 * have none. Those ids are a property of the CHAIN, not of MoonPay Trade's
 * support for it, so every network both sides ship is listed here whether or
 * not MoonPay Trade routes it today: when they add one, it works with no code
 * change. Live support is decided per quote by `GET /getPaths`, which answers
 * HTTP 200 with an empty `paths` array for a pair it cannot route (see
 * ../swap/central/mptrade.ts).
 *
 * Testnets and dev chains are null: MoonPay Trade is mainnet-only, so mapping
 * them would only buy a network round trip before the same rejection.
 *
 * Non-EVM chains ARE mapped. `GET /getChainList` tags each chain with a `vmId`
 * (`evm`, `solana`, `alt-vm`, `hypercore`) that names the execution model of a
 * route SOURCED there, and the plugin dispatches on it. `hypercore` is absent
 * because Edge ships no currency plugin for that chain.
 *
 * The `vmId` also disambiguates the chains whose numeric id belongs to an EVM
 * sibling: 314 is tagged `alt-vm`, and a live `getAction` from it returns an
 * `f1…` deposit address, so it is NATIVE Filecoin, not Filecoin FEVM.
 * Conversely `sonic`, `ethereumpow` and `pulsechain` keep their EVM ids while
 * MoonPay Trade sources them through the deposit-address flow; that is a route
 * model difference, not a mapping one.
 *
 * The value is the decimal chain id as a string; it is parsed back to a number
 * for the `srcChainId`/`dstChainId` query params.
 *
 * See https://docs.swaps.xyz/ for the API docs.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const mptrade = new Map<EdgeCurrencyPluginId, string | null>()
mptrade.set('abstract', '2741')
mptrade.set('algorand', '999000419')
mptrade.set('amoy', null) // Polygon testnet
mptrade.set('arbitrum', '42161')
mptrade.set('avalanche', '43114')
mptrade.set('base', '8453')
mptrade.set('binancesmartchain', '56')
mptrade.set('bitcoin', '999000313')
mptrade.set('bitcoincash', '10000')
mptrade.set('bitcoinsv', '999000331')
mptrade.set('bobevm', '60808')
mptrade.set('botanix', '3637')
mptrade.set('cardano', '1816')
mptrade.set('celo', '42220')
mptrade.set('cosmoshub', '999000433')
mptrade.set('dash', '999000416')
mptrade.set('digibyte', '999000301')
mptrade.set('dogecoin', '2000')
mptrade.set('ecash', '999000920')
mptrade.set('ethDev', null) // Local dev chain
mptrade.set('ethereum', '1')
mptrade.set('ethereumclassic', '61')
mptrade.set('ethereumpow', '10001')
mptrade.set('fantom', '250')
mptrade.set('filecoin', '314')
mptrade.set('filecoinfevm', null) // MoonPay Trade lists 314 as native Filecoin
mptrade.set('filecoinfevmcalibration', null) // Filecoin testnet
mptrade.set('hedera', '295')
mptrade.set('holesky', null) // Ethereum testnet
mptrade.set('hyperevm', '999')
mptrade.set('litecoin', '999000323')
mptrade.set('monad', '143')
mptrade.set('monero', '999000343')
mptrade.set('opbnb', '204')
mptrade.set('optimism', '10')
mptrade.set('osmosis', '999000446')
mptrade.set('pivx', '999000455')
mptrade.set('polygon', '137')
mptrade.set('pulsechain', '369')
mptrade.set('qtum', '999000955')
mptrade.set('ravencoin', '999000342')
mptrade.set('ripple', '999000346')
mptrade.set('rsk', '30')
mptrade.set('sepolia', null) // Ethereum testnet
mptrade.set('solana', '1399811149')
mptrade.set('sonic', '146')
mptrade.set('stellar', '999000338')
mptrade.set('sui', '999000938')
mptrade.set('tezos', '999000358')
mptrade.set('ton', '999000337')
mptrade.set('tron', '728126428')
mptrade.set('zcash', '999000322')
mptrade.set('zksync', '324')
