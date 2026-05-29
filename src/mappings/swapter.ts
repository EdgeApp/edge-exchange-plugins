/**
 * Swapter Exchange Plugin Chain Mapping
 *
 * See https://docs.swapter.io/ for API documentation
 * Currency list endpoint:
 *
 * curl -X GET 'https://api.swapter.io/data/coins' \
 *   -H 'X-API-KEY: <your-api-key>'
 *
 * This file maps EdgeCurrencyPluginId -> Swapter network identifier
 *
 * Notes:
 * - Only networks confirmed from `/data/coins` are mapped.
 * - Unsupported or unverified chains are set to `null`.
 * - Swapter uses custom network identifiers for some chains:
 *     - Avalanche C-Chain -> AVAX_C
 *      - Binance Smart Chain -> BSC
 *     - Solana -> SOLANA
 *     - Tron -> TRX
 *     - zkSync Era -> ZKS20
 *     - WAX -> WAXP
 * - Some Edge plugin IDs intentionally differ from Swapter naming.
 * - EVM chains are mapped directly because Swapter identifies them
 *   by network name instead of chain ID.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const swapter = new Map<EdgeCurrencyPluginId, string | null>()

swapter.set('abstract', null)
swapter.set('algorand', 'ALGO')
swapter.set('amoy', null)
swapter.set('arbitrum', 'ARBITRUM')
swapter.set('avalanche', 'AVAX_C')
swapter.set('axelar', null)
swapter.set('badcoin', null)
swapter.set('base', 'BASE')
swapter.set('binance', null)
swapter.set('binancesmartchain', 'BSC')
swapter.set('bitcoin', 'BTC')
swapter.set('bitcoincash', 'BCH')
swapter.set('bitcoincashtestnet', null)
swapter.set('bitcoingold', null)
swapter.set('bitcoingoldtestnet', null)
swapter.set('bitcoinsv', 'BSV')
swapter.set('bitcointestnet', null)
swapter.set('bitcointestnet4', null)
swapter.set('bobevm', null)
swapter.set('botanix', null)
swapter.set('calibration', null)
swapter.set('cardano', 'ADA')
swapter.set('cardanotestnet', null)
swapter.set('celo', 'CELO')
swapter.set('coreum', 'CORE')
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
swapter.set('ethereumpow', 'ETHW')
swapter.set('fantom', null)
swapter.set('feathercoin', null)
swapter.set('filecoin', 'FIL')
swapter.set('filecoinfevm', null)
swapter.set('filecoinfevmcalibration', null)
swapter.set('fio', 'FIO')
swapter.set('groestlcoin', null)
swapter.set('hedera', 'HBAR')
swapter.set('holesky', null)
swapter.set('hyperevm', null)
swapter.set('liberland', null)
swapter.set('liberlandtestnet', null)
swapter.set('litecoin', 'LTC')
swapter.set('mayachain', null)
swapter.set('monad', null)
swapter.set('monero', 'XMR')
swapter.set('nym', null)
swapter.set('opbnb', null)
swapter.set('optimism', 'OPTIMISM')
swapter.set('osmosis', 'OSMO')
swapter.set('piratechain', null)
swapter.set('pivx', null)
swapter.set('polkadot', 'DOT')
swapter.set('polygon', 'POLYGON')
swapter.set('pulsechain', null)
swapter.set('qtum', 'QTUM')
swapter.set('ravencoin', 'RVN')
swapter.set('ripple', 'XRP')
swapter.set('rsk', null)
swapter.set('sepolia', null)
swapter.set('smartcash', null)
swapter.set('solana', 'SOLANA')
swapter.set('sonic', 'SONIC')
swapter.set('stellar', 'XLM')
swapter.set('sui', 'SUI')
swapter.set('suitestnet', null)
swapter.set('telos', 'TELOS')
swapter.set('tezos', 'XTZ')
swapter.set('thorchainrune', null)
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
