/* eslint-disable camelcase */
/* eslint-disable no-console */
// @flow

import { type EdgeRatePlugin, makeNodeIo } from 'edge-core-js'
import { ethers } from 'ethers'
// showRate(edgeCorePlugins.coinbase, 'iso:USD', 'BTC')
import {
  ChainId,
  Currency,
  CurrencyAmount,
  ETHER,
  FACTORY_ADDRESS,
  Fetcher,
  JSBI,
  Pair,
  Percent,
  Route,
  Router,
  Token,
  TokenAmount,
  Trade,
  TradeType,
  WETH
} from 'spookyswap-sdk'

import edgeCorePlugins from '../src/index.js'

const io = makeNodeIo(__dirname)
const log = Object.assign(() => {}, { error() {}, warn() {} })

async function showRate(
  plugin,
  fromCurrency: string,
  toCurrency: string,
  initOptions: Object = {}
) {
  const instance: EdgeRatePlugin = plugin({
    initOptions,
    io,
    log,
    nativeIo: {},
    pluginDisklet: io.disklet
  })
  const pairs = await instance.fetchRates([])

  const name = instance.rateInfo.displayName
  for (const pair of pairs) {
    if (pair.fromCurrency === fromCurrency && pair.toCurrency === toCurrency) {
      const fromPretty = fromCurrency.replace(/iso:/, '')
      const toPretty = toCurrency.replace(/iso:/, '')
      console.log(`${name} ${fromPretty} to ${toPretty}: ${pair.rate}`)
    }
  }
}

async function test() {
  // TEST
  console.log('helloworld')

  // console.log(ChainId.MAINNET)
  // const USDC = new Token(
  //   ChainId.MAINNET,
  //   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  //   18,
  //   'USDC',
  //   'USD Coin'
  // )
  const DAI = new Token(
    ChainId.MAINNET,
    '0x8d11ec38a3eb5e956b052f67da8bdc9bef8abf3e',
    18,
    'DAI',
    'DAI Stablecoin'
  )
  // console.log(
  //   '\x1b[30m\x1b[42m' +
  //     `{USDC, DAI}: ${JSON.stringify({ USDC, DAI }, null, 2)}` +
  //     '\x1b[0m'
  // )

  // const token0 = new Token(
  //   ChainId.MAINNET,
  //   '0x0000000000000000000000000000000000000001',
  //   18,
  //   't0'
  // )
  // const token1 = new Token(
  //   ChainId.MAINNET,
  //   '0x0000000000000000000000000000000000000002',
  //   18,
  //   't1'
  // )
  // const pair_0_1 = new Pair(
  //   new TokenAmount(token0, JSBI.BigInt(1000)),
  //   new TokenAmount(token1, JSBI.BigInt(1000))
  // )
  // const pair_weth_0 = new Pair(
  //   new TokenAmount(WETH[ChainId.FTMTESTNET], '1000'),
  //   new TokenAmount(token0, '1000')
  // )

  // const FTM = new Token(
  //   ChainId.MAINNET,
  //   '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83',
  //   18,
  //   'FTM',
  //   'Fantom'
  // )

  const BOO = new Token(
    ChainId.MAINNET,
    '0x841fad6eae12c286d1fd18d1d525dffa75c7effe',
    18,
    'BOO',
    'SpookySwap'
  )

  const WFTM = new Token(
    ChainId.MAINNET,
    '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83',
    18,
    'FTM',
    'Fantom'
  )

  // const token = new Token(
  //   ChainId.MAINNET,
  //   '0x8d11ec38a3eb5e956b052f67da8bdc9bef8abf3e',
  //   18
  // ) // DAI
  // await Fetcher.fetchPairData(WETH[ChainId.MAINNET], token).then(pair_test =>
  //   console.log(
  //     '\x1b[34m\x1b[43m' +
  //       `pair_test: ${JSON.stringify(pair_test, null, 2)}` +
  //       '\x1b[0m'
  //   )
  // )

  const pair_ftm_boo = new Pair(
    new TokenAmount(BOO, JSBI.BigInt(1000)), // why is there an amt here
    new TokenAmount(WETH[ChainId.MAINNET], JSBI.BigInt(1000))
  )

  console.log(
    '\x1b[30m\x1b[42m' +
      `pair_ftm_boo: ${JSON.stringify(pair_ftm_boo, null, 2)}` +
      '\x1b[0m'
  )

  const pairTest = await Fetcher.fetchPairData(
    BOO,
    WETH[ChainId.MAINNET],
    new ethers.providers.JsonRpcProvider(
      // 'https://nd-009-365-506.p2pify.com/531d60a5f74fc37a9d2358a715bcf707'
      'https://rpc.fantom.network/'
    )
  )
  console.log(
    '\x1b[30m\x1b[42m' +
      `pairTest: ${JSON.stringify(pairTest, null, 2)}` +
      '\x1b[0m'
  )

  // const pair_ftm_boo = await pairFor(
  //   FACTORY_ADDRESS,
  //   ETHER[ChainId.MAINNET],
  //   '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
  // )
  const trade = new Trade(
    new Route([pair_ftm_boo], Currency.ETHER),
    CurrencyAmount.ether(JSBI.BigInt(100)),
    TradeType.EXACT_INPUT
  )
  console.log(
    '\x1b[37m\x1b[41m' + `trade: ${JSON.stringify(trade, null, 2)}` + '\x1b[0m'
  )

  const result = Router.swapCallParameters(trade, {
    ttl: 50,
    recipient: '0x0000000000000000000000000000000000000004',
    allowedSlippage: new Percent('1', '100')
  })

  console.log(
    '\x1b[34m\x1b[43m' +
      `result: ${JSON.stringify(result, null, 2)}` +
      '\x1b[0m'
  )

  const trade2 = new Trade(
    new Route([pairTest], Currency.ETHER),
    CurrencyAmount.ether(JSBI.BigInt(100)),
    TradeType.EXACT_INPUT
  )
  console.log(
    '\x1b[37m\x1b[41m' +
      `trade2: ${JSON.stringify(trade2, null, 2)}` +
      '\x1b[0m'
  )

  const result2 = Router.swapCallParameters(trade, {
    ttl: 50,
    recipient: '0x0000000000000000000000000000000000000004',
    allowedSlippage: new Percent('1', '100')
  })

  console.log(
    '\x1b[34m\x1b[43m' +
      `result2: ${JSON.stringify(result2, null, 2)}` +
      '\x1b[0m'
  )

  //
  // // 0. Find 2+ pools based on two token addresses.
  // // 1. call getPair() on factory OR that other thing
  // // 2. swap params

  // // testnet router: 0xcCAFCf876caB8f9542d6972f87B5D62e1182767d
  // // testnet factory: 0x5D479c2a7FB79E12Ac4eBBAeDB0322B4d5F9Fd02

  console.log('goodbyeworld')
}

test()
