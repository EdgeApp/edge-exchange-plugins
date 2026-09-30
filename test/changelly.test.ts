import { assert } from 'chai'
import {
  EdgeCurrencyWallet,
  EdgeSwapRequest,
  EdgeToken
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  MAINNET_CODE_TRANSCRIPTION,
  makeChainCodeTickerMap,
  makeNativeCases,
  swapInfo
} from '../src/swap/central/changelly'
import { getChainAndTokenCodes } from '../src/util/swapHelpers'

const USDC_BASE_CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const USDT_BSC_CONTRACT = '0x55d398326f99059ff775485246999027b3197955'
const ETH_BSC_CONTRACT = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'

const makeFakeWallet = (
  pluginId: string,
  currencyCode: string
): EdgeCurrencyWallet => {
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier: '1000000000000000000' }]
  }
  return ({
    currencyInfo,
    currencyConfig: {
      // `SwapCurrencyError` reads the pluginId through here.
      currencyInfo,
      allTokens: {},
      async getTokenId(token: EdgeToken) {
        return String(token.networkLocation?.contractAddress).toLowerCase()
      }
    }
  } as unknown) as EdgeCurrencyWallet
}

const asset = (
  ticker: string,
  blockchain: string,
  contractAddress?: string,
  fixRateEnabled: boolean = true
): Parameters<typeof makeChainCodeTickerMap>[0][number] => ({
  name: ticker.toUpperCase(),
  ticker,
  enabled: true,
  fixRateEnabled,
  transactionUrl: '',
  protocol: '',
  blockchain,
  contractAddress
})

/**
 * Trimmed from a live `getCurrenciesFull` response. Native coins carry no
 * `contractAddress`, and Base and zkSync use upper-case `blockchain` names.
 * Changelly lists no native ETH on zkSync, and has fixed rates off for ARRR.
 */
const TICKERS = makeChainCodeTickerMap([
  asset('btc', 'bitcoin'),
  asset('ltc', 'litecoin'),
  asset('doge', 'doge'),
  asset('xmr', 'monero'),
  asset('arrr', 'arrr', undefined, false),
  asset('eth', 'ethereum'),
  asset('etharb', 'arbitrum'),
  asset('ethop', 'optimism'),
  asset('ethbase', 'BASE'),
  asset('usdcbase', 'BASE', USDC_BASE_CONTRACT),
  asset('zksync', 'ZKSYNC', '0x5a7d6b2f92c77fad6ccabd7ee0624e64907eaf3e'),
  asset('bnbbsc', 'binance_smart_chain'),
  asset('usdtbsc', 'binance_smart_chain', USDT_BSC_CONTRACT),
  asset('ethbsc', 'binance_smart_chain', ETH_BSC_CONTRACT),
  asset('avax', 'avalanche'),
  asset('avaxc', 'avaxc'),
  asset('gram', 'ton')
])

const getCodes = async (
  fromWallet: EdgeCurrencyWallet,
  toWallet: EdgeCurrencyWallet,
  toTokenId: string | null = null,
  tickers = TICKERS
): ReturnType<typeof getChainAndTokenCodes> => {
  const request: EdgeSwapRequest = {
    fromWallet,
    toWallet,
    fromTokenId: null,
    toTokenId,
    nativeAmount: '100000',
    quoteFor: 'from'
  }
  return await getChainAndTokenCodes(
    request,
    swapInfo,
    tickers,
    MAINNET_CODE_TRANSCRIPTION,
    makeNativeCases([fromWallet, toWallet], tickers)
  )
}

const getToCodes = async (
  toWallet: EdgeCurrencyWallet,
  toTokenId: string | null = null
): ReturnType<typeof getChainAndTokenCodes> =>
  await getCodes(makeFakeWallet('bitcoin', 'BTC'), toWallet, toTokenId)

const assertUnsupported = async (promise: Promise<unknown>): Promise<void> => {
  await promise.then(
    () => assert.fail('expected SwapCurrencyError'),
    (error: unknown) => {
      assert.equal((error as Error).name, 'SwapCurrencyError')
    }
  )
}

describe('Changelly native tickers', function () {
  const cases: Array<[string, string, string]> = [
    ['ethereum', 'ETH', 'eth'],
    ['arbitrum', 'ETH', 'etharb'],
    ['optimism', 'ETH', 'ethop'],
    ['base', 'ETH', 'ethbase'],
    ['binancesmartchain', 'BNB', 'bnbbsc'],
    ['avalanche', 'AVAX', 'avaxc'],
    ['ton', 'TON', 'gram']
  ]
  for (const [edgePluginId, currencyCode, ticker] of cases) {
    it(`sends ${edgePluginId} ${currencyCode} as ${ticker}`, async function () {
      const codes = await getToCodes(makeFakeWallet(edgePluginId, currencyCode))
      assert.equal(codes.toCurrencyCode, ticker)
    })
  }

  it('sends L2 ETH on the source side as its L2 ticker', async function () {
    const codes = await getCodes(
      makeFakeWallet('base', 'ETH'),
      makeFakeWallet('monero', 'XMR')
    )
    assert.equal(codes.fromCurrencyCode, 'ethbase')
    assert.equal(codes.fromMainnetCode, 'base')
    assert.equal(codes.toCurrencyCode, 'xmr')
  })

  it('swaps between mainnet coins without contracts', async function () {
    const litecoinToMonero = await getCodes(
      makeFakeWallet('litecoin', 'LTC'),
      makeFakeWallet('monero', 'XMR')
    )
    assert.equal(litecoinToMonero.fromCurrencyCode, 'ltc')
    assert.equal(litecoinToMonero.fromMainnetCode, 'litecoin')
    assert.equal(litecoinToMonero.toCurrencyCode, 'xmr')
    assert.equal(litecoinToMonero.toMainnetCode, 'monero')

    const dogecoinToBitcoin = await getCodes(
      makeFakeWallet('dogecoin', 'DOGE'),
      makeFakeWallet('bitcoin', 'BTC')
    )
    assert.equal(dogecoinToBitcoin.fromCurrencyCode, 'doge')
    assert.equal(dogecoinToBitcoin.fromMainnetCode, 'doge')
    assert.equal(dogecoinToBitcoin.toCurrencyCode, 'btc')
  })

  it('resolves tokens on an upper-case blockchain', async function () {
    const codes = await getToCodes(
      makeFakeWallet('base', 'ETH'),
      USDC_BASE_CONTRACT
    )
    assert.equal(codes.toCurrencyCode, 'usdcbase')
  })

  it('resolves BSC tokens by contract address', async function () {
    const bsc = makeFakeWallet('binancesmartchain', 'BNB')
    const usdt = await getToCodes(bsc, USDT_BSC_CONTRACT)
    assert.equal(usdt.toCurrencyCode, 'usdtbsc')
    assert.equal(usdt.toMainnetCode, 'binance_smart_chain')

    // Binance-Peg ETH is a BSC token, not Ethereum mainnet ETH:
    const eth = await getToCodes(bsc, ETH_BSC_CONTRACT)
    assert.equal(eth.toCurrencyCode, 'ethbsc')
  })

  it('rejects BSC tokens Changelly does not list', async function () {
    await assertUnsupported(
      getToCodes(
        makeFakeWallet('binancesmartchain', 'BNB'),
        '0x0000000000000000000000000000000000000001'
      )
    )
  })

  it('rejects zkSync ETH, which Changelly does not list', async function () {
    await assertUnsupported(getToCodes(makeFakeWallet('zksync', 'ETH')))
  })

  it('rejects native coins without fixed rates', async function () {
    await assertUnsupported(getToCodes(makeFakeWallet('piratechain', 'ARRR')))
  })

  it('never takes another contract-less asset as the native coin', async function () {
    // Changelly turned off fixed rates for ETH on Arbitrum, but still lists
    // some other contract-less asset there:
    const tickers = makeChainCodeTickerMap([
      asset('btc', 'bitcoin'),
      asset('etharb', 'arbitrum', undefined, false),
      asset('other', 'arbitrum')
    ])
    await assertUnsupported(
      getCodes(
        makeFakeWallet('bitcoin', 'BTC'),
        makeFakeWallet('arbitrum', 'ETH'),
        null,
        tickers
      )
    )
  })

  it('rejects native coins before the asset list loads', async function () {
    await assertUnsupported(
      getCodes(
        makeFakeWallet('bitcoin', 'BTC'),
        makeFakeWallet('arbitrum', 'ETH'),
        null,
        new Map()
      )
    )
  })
})
