/**
 * HoudiniSwap Chain Mapping
 *
 * Maps EdgeCurrencyPluginId -> Houdini chain `shortName` (or null when Houdini
 * has no equivalent chain, or the chain is excluded from the MVP).
 *
 * Source: authenticated `GET /v2/chains` intersected with Edge's supported
 * assets. See the Phase 1 coverage matrix attached to the Asana task.
 *
 * Excluded on purpose (mapped to null / omitted):
 * - memoNeeded chains (ripple, stellar, cosmoshub, hedera, ton, thorchainrune):
 *   Houdini requires a destination tag/memo for these; sending without one risks
 *   loss of funds, so they are not enabled in this prototype.
 * - chains Houdini does not serve (tezos, filecoin, eos, fio, wax, zano, …).
 *
 * Unlike EVM-by-chainId aggregators, Houdini identifies every chain (including
 * EVM) by `shortName`, so EVM chains are listed here.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const houdini = new Map<EdgeCurrencyPluginId, string | null>()

// UTXO / BTC-family
houdini.set('bitcoin', 'bitcoin')
houdini.set('bitcoincash', 'bitcoincash')
houdini.set('bitcoinsv', 'bsv')
houdini.set('litecoin', 'litecoin')
houdini.set('dogecoin', 'doge')
houdini.set('dash', 'dash')
houdini.set('ecash', 'eCash')
houdini.set('pivx', 'pivx')
houdini.set('zcoin', 'firo')
houdini.set('zcash', 'Zcash')

// EVM
houdini.set('ethereum', 'ethereum')
houdini.set('arbitrum', 'arbitrum')
houdini.set('base', 'base')
houdini.set('optimism', 'optimism')
houdini.set('polygon', 'polygon')
houdini.set('avalanche', 'avalanche')
houdini.set('binancesmartchain', 'bsc')
houdini.set('celo', 'celo')
houdini.set('fantom', 'fantom')
houdini.set('pulsechain', 'pulsechain')
houdini.set('sonic', 'sonic')
houdini.set('opbnb', 'opbnb')
houdini.set('hyperevm', 'hyperevm')
houdini.set('zksync', 'zksync-era')
houdini.set('rsk', 'rootstock')
houdini.set('bobevm', 'bob')
houdini.set('monad', 'MON')
houdini.set('telos', 'telos')

// Other non-EVM L1s served without a memo
houdini.set('solana', 'solana')
houdini.set('cardano', 'cardano')
houdini.set('polkadot', 'polkadot')
houdini.set('tron', 'tron')
houdini.set('sui', 'sui')
houdini.set('monero', 'monero')
houdini.set('algorand', 'algorand')

// IBC / cosmos-family without a memo (opaque address validation)
houdini.set('osmosis', 'osmosis-1')
houdini.set('coreum', 'coreum-mainnet-1')
houdini.set('axelar', 'axelar-dojo-1')
