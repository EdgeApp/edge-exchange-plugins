/**
 * StealthEX Exchange Plugin Chain Mapping
 *
 * See https://api.stealthex.io/docs/ for the API reference. To list the
 * supported assets:
 * `curl -X GET 'https://api.stealthex.io/v4/currencies?limit=250&offset=0' -H 'Authorization: Bearer <your-api-key>' | jq .`
 *
 * StealthEX identifies every asset by a `symbol` plus a `network`. A chain's
 * native asset usually sits on the `mainnet` network, but plenty of chains are
 * listed under their own network instead (BNB on `bsc`, AVAX on `avax-c`, ETH
 * on each L2's network), so both halves are spelled out per chain. Tokens use
 * the chain's `tokenNetwork` together with the token's own symbol.
 *
 * This file maps EdgeCurrencyPluginId -> StealthEX chain identity (or null when
 * StealthEX does not list the chain).
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export interface StealthexChain {
  /** StealthEX symbol of the chain's native asset */
  mainnetSymbol: string
  /** StealthEX network hosting the chain's native asset */
  mainnetNetwork: string
  /** StealthEX network hosting the chain's tokens, or null when unsupported */
  tokenNetwork: string | null
}

export const stealthex = new Map<EdgeCurrencyPluginId, StealthexChain | null>()
stealthex.set('abstract', null)
stealthex.set('algorand', {
  mainnetSymbol: 'algo',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'algo'
})
stealthex.set('amoy', null)
stealthex.set('arbitrum', {
  mainnetSymbol: 'eth',
  mainnetNetwork: 'arbitrum',
  tokenNetwork: 'arbitrum'
})
stealthex.set('avalanche', {
  mainnetSymbol: 'avax',
  mainnetNetwork: 'avax-c',
  tokenNetwork: 'avax-c'
})
stealthex.set('axelar', {
  mainnetSymbol: 'axl',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('badcoin', null)
stealthex.set('base', {
  mainnetSymbol: 'eth',
  mainnetNetwork: 'base',
  tokenNetwork: 'base'
})
// StealthEX lists no BEP2 assets:
stealthex.set('binance', null)
stealthex.set('binancesmartchain', {
  mainnetSymbol: 'bnb',
  mainnetNetwork: 'bsc',
  tokenNetwork: 'bsc'
})
stealthex.set('bitcoin', {
  mainnetSymbol: 'btc',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('bitcoincash', {
  mainnetSymbol: 'bch',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('bitcoincashtestnet', null)
stealthex.set('bitcoingold', null)
stealthex.set('bitcoingoldtestnet', null)
stealthex.set('bitcoinsv', {
  mainnetSymbol: 'bsv',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('bitcointestnet', null)
stealthex.set('bitcointestnet4', null)
stealthex.set('bobevm', null)
stealthex.set('botanix', null)
stealthex.set('calibration', null)
stealthex.set('cardano', {
  mainnetSymbol: 'ada',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'ada'
})
stealthex.set('cardanotestnet', null)
stealthex.set('celo', {
  mainnetSymbol: 'celo',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'celo'
})
stealthex.set('coreum', null)
stealthex.set('cosmoshub', {
  mainnetSymbol: 'atom',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('dash', {
  mainnetSymbol: 'dash',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('digibyte', {
  mainnetSymbol: 'dgb',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('dogecoin', {
  mainnetSymbol: 'doge',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('eboost', null)
stealthex.set('ecash', {
  mainnetSymbol: 'xec',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
// EOS was rebranded to Vaulta, and StealthEX lists it under its new `a` symbol:
stealthex.set('eos', {
  mainnetSymbol: 'a',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('ethDev', null)
stealthex.set('ethereum', {
  mainnetSymbol: 'eth',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'eth'
})
stealthex.set('ethereumclassic', {
  mainnetSymbol: 'etc',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('ethereumpow', {
  mainnetSymbol: 'ethw',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
// StealthEX delisted FTM when Fantom became Sonic:
stealthex.set('fantom', null)
stealthex.set('feathercoin', null)
stealthex.set('filecoin', {
  mainnetSymbol: 'fil',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
// StealthEX only supports Filecoin's native address space:
stealthex.set('filecoinfevm', null)
stealthex.set('filecoinfevmcalibration', null)
stealthex.set('fio', {
  mainnetSymbol: 'fio',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('groestlcoin', null)
stealthex.set('hedera', {
  mainnetSymbol: 'hbar',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('holesky', null)
stealthex.set('hyperevm', {
  mainnetSymbol: 'hype',
  mainnetNetwork: 'hyperevm',
  tokenNetwork: 'hyperevm'
})
stealthex.set('liberland', null)
stealthex.set('liberlandtestnet', null)
stealthex.set('litecoin', {
  mainnetSymbol: 'ltc',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('mayachain', null)
// StealthEX's `monad` listing carries no address format, so the address space it
// expects cannot be confirmed:
stealthex.set('monad', null)
stealthex.set('monero', {
  mainnetSymbol: 'xmr',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
// StealthEX only lists NYM as an Ethereum token, not the Nyx chain:
stealthex.set('nym', null)
stealthex.set('opbnb', null)
stealthex.set('optimism', {
  mainnetSymbol: 'eth',
  mainnetNetwork: 'optimism',
  tokenNetwork: 'optimism'
})
stealthex.set('osmosis', {
  mainnetSymbol: 'osmo',
  mainnetNetwork: 'cosmos',
  tokenNetwork: null
})
stealthex.set('piratechain', {
  mainnetSymbol: 'arrr',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('pivx', {
  mainnetSymbol: 'pivx',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('polkadot', {
  mainnetSymbol: 'dot',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('polygon', {
  mainnetSymbol: 'pol',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'matic'
})
stealthex.set('pulsechain', {
  mainnetSymbol: 'pls',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('qtum', {
  mainnetSymbol: 'qtum',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('ravencoin', null)
stealthex.set('ripple', {
  mainnetSymbol: 'xrp',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'xrp'
})
stealthex.set('rsk', null)
stealthex.set('sepolia', null)
stealthex.set('smartcash', null)
stealthex.set('solana', {
  mainnetSymbol: 'sol',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'sol'
})
stealthex.set('sonic', {
  mainnetSymbol: 's',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('stellar', {
  mainnetSymbol: 'xlm',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'xlm'
})
stealthex.set('sui', {
  mainnetSymbol: 'sui',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'sui'
})
stealthex.set('suitestnet', null)
// StealthEX's `tlos` listing carries no address format, so whether it expects
// native Telos or Telos EVM addresses cannot be confirmed:
stealthex.set('telos', null)
stealthex.set('tezos', {
  mainnetSymbol: 'xtz',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'xtz'
})
stealthex.set('thorchainrune', {
  mainnetSymbol: 'rune',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('thorchainrunestagenet', null)
stealthex.set('ton', {
  mainnetSymbol: 'ton',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'ton'
})
stealthex.set('tron', {
  mainnetSymbol: 'trx',
  mainnetNetwork: 'mainnet',
  tokenNetwork: 'trx'
})
stealthex.set('ufo', null)
stealthex.set('vertcoin', null)
stealthex.set('wax', {
  mainnetSymbol: 'waxp',
  mainnetNetwork: 'wax',
  tokenNetwork: null
})
stealthex.set('zano', {
  mainnetSymbol: 'zano',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('zcash', {
  mainnetSymbol: 'zec',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('zcoin', {
  mainnetSymbol: 'firo',
  mainnetNetwork: 'mainnet',
  tokenNetwork: null
})
stealthex.set('zksync', {
  mainnetSymbol: 'eth',
  mainnetNetwork: 'zksync',
  tokenNetwork: 'zksync'
})
