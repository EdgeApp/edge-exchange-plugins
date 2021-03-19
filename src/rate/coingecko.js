// @flow

import { asMap, asNumber, asObject } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

const asGeckoBulkUsdReply = asMap(asObject({ usd: asNumber }))

const coinGeckoMap = {
  TLOS: 'telos',
  FIRO: 'zcoin',
  ANT: 'aragon',
  TBTC: 'tbtc',
  FIO: 'fio-protocol',
  VTC: 'vertcoin',
  SMART: 'smartcash',
  GRS: 'groestlcoin',
  FUN: 'funfair',
  BADGER: 'badger-dao',
  CREAM: 'cream-2',
  CVP: 'concentrated-voting-power',
  DOUGH: 'piedao-dough-v2',
  ETHBNT: 'ethbnt',
  SUSD: 'nusd',
  USDS: 'stableusd',
  TUSD: 'true-usd',
  GUSD: 'gemini-dollar',
  YETI: 'yearn-ecosystem-token-index',
  PAX: 'paxos-standard',
  RBTC: 'rootstock',
  RIF: 'rif-token',
  FTC: 'feathercoin',
  GLM: 'golem',
  GNO: 'gnosis',
  STORJ: 'storj',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BCH: 'bitcoin-cash',
  BNB: 'binancecoin',
  EOS: 'eos',
  ETC: 'ethereum-classic',
  XLM: 'stellar',
  XTZ: 'tezos',
  XRP: 'ripple',
  BTG: 'bitcoin-gold',
  BSV: 'bitcoin-cash-sv',
  DASH: 'dash',
  DGB: 'digibyte',
  DOGE: 'dogecoin',
  EBST: 'eboost',
  LTC: 'litecoin',
  QTUM: 'qtum',
  RVN: 'ravencoin',
  UFO: 'ufocoin',
  XMR: 'monero',
  REP: 'augur',
  DAI: 'dai',
  SAI: 'sai',
  WINGS: 'wings',
  USDT: 'tether',
  IND: 'indorse',
  HUR: 'hurify',
  BAT: 'basic-attention-token',
  BNT: 'bounty0x',
  KNC: 'kyber-network',
  POLY: 'polymath-network',
  USDC: 'usd-coin',
  ZRX: '0x',
  OMG: 'omisego',
  NMR: 'numeraire',
  MKR: 'maker',
  SALT: 'salt',
  MANA: 'decentraland',
  NEXO: 'nexo',
  KIN: 'kin',
  LINK: 'chainlink',
  BRZ: 'brz',
  CREP: 'compound-augur',
  CUSDC: 'compound-usd-coin',
  CETH: 'compound-ether',
  CBAT: 'compound-basic-attention-token',
  CZRX: 'compound-0x',
  CWBTC: 'compound-wrapped-btc',
  CSAI: 'compound-sai',
  CDAI: 'cdai',
  OXT: 'orchid-protocol',
  COMP: 'compound-governance-token',
  MET: 'metronome',
  SNX: 'havven',
  SBTC: 'sbtc',
  AAVE: 'aave',
  WBTC: 'wrapped-bitcoin',
  YFI: 'yearn-finance',
  CRV: 'curve-dao-token',
  BAL: 'balancer',
  SUSHI: 'sushi',
  UMA: 'uma',
  IDLE: 'idle',
  NXM: 'nxm',
  PICKLE: 'pickle-finance',
  ROOK: 'rook',
  INDEX: 'index-cooperative',
  WETH: 'weth',
  RENBTC: 'renbtc',
  RENBCH: 'renbch',
  RENZEC: 'renzec',
  DPI: 'defipulse-index',
  BAND: 'band-protocol',
  REN: 'republic-protocol',
  AMPL: 'ampleforth',
  OCEAN: 'ocean-protocol'
}

export function makeCoinGeckoPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts

  return {
    rateInfo: {
      displayName: 'Coingecko',
      pluginId: 'coingecko'
    },

    async fetchRates(pairsHint) {
      const pairs = []
      const query = []
      for (const pair of pairsHint) {
        // Coingecko is only used to query specific currencies
        if (coinGeckoMap[pair.fromCurrency])
          query.push(coinGeckoMap[pair.fromCurrency])
      }
      try {
        const reply = await io.fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${query.join(
            ','
          )}&vs_currencies=usd`
        )
        const json = await reply.json()
        const rates = asGeckoBulkUsdReply(json)
        Object.keys(rates).forEach(rate => {
          const fromCurrency = Object.keys(coinGeckoMap).find(
            key => typeof key === 'string' && coinGeckoMap[key] === rate
          )
          if (fromCurrency)
            pairs.push({
              fromCurrency,
              toCurrency: 'iso:USD',
              rate: rates[rate].usd
            })
        })
      } catch (e) {
        log.warn(`Issue with Coingecko rate data structure ${e}`)
      }
      return pairs
    }
  }
}
