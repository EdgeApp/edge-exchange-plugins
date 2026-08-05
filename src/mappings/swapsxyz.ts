/**
 * swaps.xyz Exchange Plugin Chain Mapping
 *
 * Maps EdgeCurrencyPluginId -> swaps.xyz numeric `chainId` (as a string) or
 * null when the chain can never be offered.
 *
 * swaps.xyz (a MoonPay product) is a cross-chain swap aggregator whose REST API
 * identifies every network by a numeric chain id: the real EVM chain id where
 * one exists, and a synthetic id in the 999000xxx range for the chains that
 * have none. Those ids are a property of the CHAIN, not of swaps.xyz's support
 * for it, so every network both sides ship is listed here whether or not
 * swaps.xyz routes it today: when they add one, it works with no code change.
 * Live support is decided per quote by `GET /getPaths`, which answers HTTP 200
 * with an empty `paths` array for a pair it cannot route (see
 * ../swap/central/swapsxyz.ts).
 *
 * Testnets and dev chains are null: swaps.xyz is mainnet-only, so mapping them
 * would only buy a network round trip before the same rejection.
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
 * swaps.xyz sources them through the deposit-address flow; that is a route
 * model difference, not a mapping one.
 *
 * The value is the decimal chain id as a string; it is parsed back to a number
 * for the `srcChainId`/`dstChainId` query params.
 *
 * See https://docs.swaps.xyz/ for the API docs.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const swapsxyz = new Map<EdgeCurrencyPluginId, string | null>()
swapsxyz.set('abstract', '2741')
swapsxyz.set('algorand', '999000419')
swapsxyz.set('amoy', null) // Polygon testnet
swapsxyz.set('arbitrum', '42161')
swapsxyz.set('avalanche', '43114')
swapsxyz.set('base', '8453')
swapsxyz.set('binancesmartchain', '56')
swapsxyz.set('bitcoin', '999000313')
swapsxyz.set('bitcoincash', '10000')
swapsxyz.set('bitcoinsv', '999000331')
swapsxyz.set('bobevm', '60808')
swapsxyz.set('botanix', '3637')
swapsxyz.set('cardano', '1816')
swapsxyz.set('celo', '42220')
swapsxyz.set('cosmoshub', '999000433')
swapsxyz.set('dash', '999000416')
swapsxyz.set('digibyte', '999000301')
swapsxyz.set('dogecoin', '2000')
swapsxyz.set('ecash', '999000920')
swapsxyz.set('ethDev', null) // Local dev chain
swapsxyz.set('ethereum', '1')
swapsxyz.set('ethereumclassic', '61')
swapsxyz.set('ethereumpow', '10001')
swapsxyz.set('fantom', '250')
swapsxyz.set('filecoin', '314')
swapsxyz.set('filecoinfevm', null) // swaps.xyz lists 314 as native Filecoin
swapsxyz.set('filecoinfevmcalibration', null) // Filecoin testnet
swapsxyz.set('hedera', '295')
swapsxyz.set('holesky', null) // Ethereum testnet
swapsxyz.set('hyperevm', '999')
swapsxyz.set('litecoin', '999000323')
swapsxyz.set('monad', '143')
swapsxyz.set('monero', '999000343')
swapsxyz.set('opbnb', '204')
swapsxyz.set('optimism', '10')
swapsxyz.set('osmosis', '999000446')
swapsxyz.set('pivx', '999000455')
swapsxyz.set('polygon', '137')
swapsxyz.set('pulsechain', '369')
swapsxyz.set('qtum', '999000955')
swapsxyz.set('ravencoin', '999000342')
swapsxyz.set('ripple', '999000346')
swapsxyz.set('rsk', '30')
swapsxyz.set('sepolia', null) // Ethereum testnet
swapsxyz.set('solana', '1399811149')
swapsxyz.set('sonic', '146')
swapsxyz.set('stellar', '999000338')
swapsxyz.set('sui', '999000938')
swapsxyz.set('tezos', '999000358')
swapsxyz.set('ton', '999000337')
swapsxyz.set('tron', '728126428')
swapsxyz.set('zcash', '999000322')
swapsxyz.set('zksync', '324')
