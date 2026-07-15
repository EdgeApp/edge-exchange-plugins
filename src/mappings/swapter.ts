/**
 * Swapter Exchange Plugin Chain Mapping
 *
 * See https://docs.swapter.io/ for API documentation
 * Currency list endpoint, which must be called UNAUTHENTICATED:
 *
 * curl -X GET 'https://api.swapter.io/data/coins'
 *
 * Sending an `X-API-KEY` header here answers 401 for a valid key, a garbage key
 * and an empty value alike, which is why the plugin fetches this one route with
 * `publicHeaders`. A curl carrying the key reproduces an empty ticker map, not
 * the real list.
 *
 * This file maps EdgeCurrencyPluginId -> Swapter network identifier
 *
 * Notes:
 * - Only networks confirmed from `/data/coins` are mapped.
 * - Unsupported or unverified chains are set to `null`.
 * - Swapter uses custom network identifiers for some chains:
 *     - Avalanche C-Chain -> AVAX_C
 *     - Binance Smart Chain -> BSC
 *     - Ethereum PoW -> ETHEREUM POW (note the space)
 *     - Tron -> TRX
 *     - zkSync Era -> ZKS20
 *     - WAX -> WAXP
 * - Some Edge plugin IDs intentionally differ from Swapter naming.
 * - EVM chains are mapped directly because Swapter identifies them
 *   by network name instead of chain ID.
 * - Swapter renames network identifiers over time (Arbitrum was `ARBITRUM`,
 *   now `ARB`). A stale code here is not caught by any type: mainnet quotes
 *   still reach the API and fail with Swapter's "combination does not exists"
 *   error, while token quotes throw `SwapCurrencyError` because `/data/coins`
 *   returns no ticker set for the unknown network. Re-verify every code against
 *   `/data/coins` before editing this file.
 * - A chain whose Edge `currencyCode` differs from Swapter's asset code cannot
 *   be mapped here alone: `getChainAndTokenCodes` derives the mainnet ticker
 *   from `currencyInfo.currencyCode`. Three chains need a `SPECIAL_MAINNET_CASES`
 *   entry in the plugin for that reason: native TON is listed as `GRAM`, Bitcoin
 *   SV is `BSV` in Edge and `BCHSV` on Swapter (both the network and the asset),
 *   and the EOS network lists only Vaulta's `A` since the rebrand. Swapter lists
 *   no `BSV` network at all, so mapping it to `BSV` would break the chain
 *   outright.
 * - A mapped network does NOT imply the native asset is quotable. zkSync's
 *   `ZKS20` lists the `ZK` token but no native ETH, so the network stays mapped
 *   (tokens quote) while the native is blocked through the plugin's
 *   `INVALID_TOKEN_IDS`.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const swapter = new Map<EdgeCurrencyPluginId, string | null>()

swapter.set('abstract', null)
swapter.set('algorand', 'ALGO')
swapter.set('amoy', null)
swapter.set('arbitrum', 'ARB')
swapter.set('avalanche', 'AVAX_C')
swapter.set('axelar', 'AXL')
swapter.set('badcoin', null)
swapter.set('base', 'BASE')
swapter.set('binance', null)
swapter.set('binancesmartchain', 'BSC')
swapter.set('bitcoin', 'BTC')
swapter.set('bitcoincash', 'BCH')
swapter.set('bitcoincashtestnet', null)
swapter.set('bitcoingold', null)
swapter.set('bitcoingoldtestnet', null)
swapter.set('bitcoinsv', 'BCHSV')
swapter.set('bitcointestnet', null)
swapter.set('bitcointestnet4', null)
swapter.set('bobevm', null)
swapter.set('botanix', null)
swapter.set('calibration', null)
swapter.set('cardano', 'ADA')
swapter.set('cardanotestnet', null)
swapter.set('celo', 'CELO')
swapter.set('coreum', null)
swapter.set('cosmoshub', 'ATOM')
swapter.set('dash', 'DASH')
swapter.set('digibyte', 'DGB')
swapter.set('dogecoin', 'DOGE')
swapter.set('eboost', null)
swapter.set('ecash', 'XEC')
swapter.set('eos', 'EOS')
swapter.set('ethDev', null)
swapter.set('ethereum', 'ETH')
swapter.set('ethereumclassic', 'ETC')
swapter.set('ethereumpow', 'ETHEREUM POW')
swapter.set('fantom', null)
swapter.set('feathercoin', null)
swapter.set('filecoin', 'FIL')
swapter.set('filecoinfevm', null)
swapter.set('filecoinfevmcalibration', null)
swapter.set('fio', null)
swapter.set('groestlcoin', null)
swapter.set('hedera', 'HBAR')
swapter.set('holesky', null)
swapter.set('hyperevm', 'HYPEREVM')
swapter.set('liberland', null)
swapter.set('liberlandtestnet', null)
swapter.set('litecoin', 'LTC')
swapter.set('mayachain', null)
swapter.set('monad', 'MONAD')
swapter.set('monero', 'XMR')
swapter.set('nym', null)
swapter.set('opbnb', null)
swapter.set('optimism', 'OP')
swapter.set('osmosis', 'OSMO')
swapter.set('piratechain', null)
swapter.set('pivx', null)
swapter.set('polkadot', 'DOT')
swapter.set('polygon', 'POL')
swapter.set('pulsechain', null)
swapter.set('qtum', 'QTUM')
swapter.set('ravencoin', null)
swapter.set('ripple', 'XRP')
swapter.set('rsk', null)
swapter.set('sepolia', null)
swapter.set('smartcash', null)
swapter.set('solana', 'SOL')
swapter.set('sonic', 'SONIC')
swapter.set('stellar', 'XLM')
swapter.set('sui', 'SUI')
swapter.set('suitestnet', null)
swapter.set('telos', 'TELOS')
swapter.set('tezos', 'XTZ')
swapter.set('thorchainrune', 'RUNE')
swapter.set('thorchainrunestagenet', null)
swapter.set('ton', 'TON')
swapter.set('tron', 'TRX')
swapter.set('ufo', null)
swapter.set('vertcoin', null)
swapter.set('wax', 'WAXP')
swapter.set('zano', null)
swapter.set('zcash', 'ZEC')
swapter.set('zcoin', null)
swapter.set('zksync', 'ZKS20')
