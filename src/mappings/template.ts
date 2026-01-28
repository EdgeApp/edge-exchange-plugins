/**
 * Template Exchange Plugin Chain Mapping
 *
 * TODO: Replace with actual API documentation URL
 * See https://example.com/exchange-pairs for list of supported currencies
 * Or `curl -X GET 'https://api.example.com/api/v2/coins' -H 'Authorization: Bearer <your-api-key>' | jq .`
 *
 * This file maps EdgeCurrencyPluginId -> exchange network identifier (or null)
 *
 * Note: EVM chains are not included here because they are identified by their
 * chain ID (evmChainId) in the plugin code, not by network name mapping.
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const template = new Map<EdgeCurrencyPluginId, string | null>()
template.set('algorand', 'ALGO')
template.set('axelar', 'WAXL')
template.set('badcoin', null)
template.set('binance', 'BEP2')
template.set('bitcoin', 'BTC')
template.set('bitcoincash', 'BCH')
template.set('bitcoincashtestnet', null)
template.set('bitcoingold', 'BTG')
template.set('bitcoingoldtestnet', null)
template.set('bitcoinsv', 'BSV')
template.set('bitcointestnet', null)
template.set('bitcointestnet4', null)
template.set('cardano', 'ADA')
template.set('cardanotestnet', null)
template.set('coreum', 'COREUM')
template.set('cosmoshub', 'ATOM')
template.set('dash', 'DASH')
template.set('digibyte', 'DGB')
template.set('dogecoin', 'DOGE')
template.set('eboost', null)
template.set('ecash', 'XEC')
template.set('eos', 'EOS')
template.set('feathercoin', null)
template.set('filecoin', 'FIL')
template.set('fio', 'FIO')
template.set('groestlcoin', 'GRS')
template.set('hedera', 'HBAR')
template.set('liberland', null)
template.set('liberlandtestnet', null)
template.set('litecoin', 'LTC')
template.set('monero', 'XMR')
template.set('osmosis', 'OSMO')
template.set('piratechain', 'ARRR')
template.set('pivx', 'PIVX')
template.set('polkadot', 'DOT')
template.set('qtum', 'QTUM')
template.set('ravencoin', 'RVN')
template.set('ripple', 'XRP')
template.set('smartcash', null)
template.set('solana', 'SOL')
template.set('stellar', 'XLM')
template.set('sui', 'SUI')
template.set('suitestnet', null)
template.set('telos', 'TLOS')
template.set('tezos', 'XTZ')
template.set('thorchainrune', 'RUNE')
template.set('thorchainrunestagenet', null)
template.set('ton', 'TON')
template.set('tron', 'TRC20')
template.set('ufo', null)
template.set('vertcoin', null)
template.set('wax', 'WAX')
// TODO: Enable ZANO after testing integrated address/payment id
template.set('zano', null)
template.set('zcash', 'ZEC')
template.set('zcoin', 'FIRO')
