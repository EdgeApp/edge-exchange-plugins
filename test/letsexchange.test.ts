import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSwapRequest,
  EdgeToken
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  MAINNET_CODE_TRANSCRIPTION,
  makeLetsExchangePlugin,
  SPECIAL_MAINNET_CASES,
  swapInfo
} from '../src/swap/central/letsexchange'
import {
  ChainCodeTickerMap,
  getChainAndTokenCodes
} from '../src/util/swapHelpers'

const USDT0_CONTRACT = '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb'

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
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: '0x1234' }]
    },
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

const makeRequest = (
  toTokenId: string | null,
  toPluginId: string = 'hyperevm'
): EdgeSwapRequest => ({
  fromWallet: makeFakeWallet('ethereum', 'ETH'),
  toWallet: makeFakeWallet(toPluginId, 'HYPE'),
  fromTokenId: null,
  toTokenId,
  nativeAmount: '100000000000000000',
  quoteFor: 'from'
})

/**
 * LetsExchange lists HyperEVM as `HYPEEVM` and Hyperliquid's HyperCore as
 * `HYPE`, each with its own assets.
 */
const TICKERS: ChainCodeTickerMap = new Map([
  ['ETH', [{ tokenCode: 'ETH', contractAddress: null }]],
  [
    'HYPEEVM',
    [
      { tokenCode: 'HYPE', contractAddress: null },
      { tokenCode: 'USDT0', contractAddress: USDT0_CONTRACT }
    ]
  ],
  ['HYPE', [{ tokenCode: 'USDC', contractAddress: '0xhypercoreusdc' }]]
])

const getCodes = async (
  request: EdgeSwapRequest
): ReturnType<typeof getChainAndTokenCodes> =>
  await getChainAndTokenCodes(
    request,
    swapInfo,
    TICKERS,
    MAINNET_CODE_TRANSCRIPTION,
    SPECIAL_MAINNET_CASES
  )

describe('LetsExchange Hyperliquid codes', function () {
  it('sends native HYPE on the HYPEEVM network', async function () {
    const codes = await getCodes(makeRequest(null))
    assert.equal(codes.toMainnetCode, 'HYPEEVM')
    assert.equal(codes.toCurrencyCode, 'HYPE')
  })

  it('resolves HyperEVM tokens on the HYPEEVM network', async function () {
    const codes = await getCodes(makeRequest(USDT0_CONTRACT))
    assert.equal(codes.toMainnetCode, 'HYPEEVM')
    assert.equal(codes.toCurrencyCode, 'USDT0')
  })

  it('sends native HyperCore HYPE on the HYPE network', async function () {
    const codes = await getCodes(makeRequest(null, 'hypercore'))
    assert.equal(codes.toMainnetCode, 'HYPE')
    assert.equal(codes.toCurrencyCode, 'HYPE')
  })

  it('never resolves a HyperEVM token against HyperCore', async function () {
    await getCodes(makeRequest('0xhypercoreusdc')).then(
      () => assert.fail('expected SwapCurrencyError'),
      (error: unknown) => {
        assert.equal((error as Error).name, 'SwapCurrencyError')
      }
    )
  })
})

describe('LetsExchange quote errors', function () {
  it('reports an unavailable coin or network as unsupported', async function () {
    // Live reply for HyperCore HYPE, which LetsExchange lists as inactive:
    const unavailable = '{"success":false,"error":"HYPE(HYPE) not available."}'
    const plugin = makeLetsExchangePlugin(({
      io: {
        fetchCors: async (uri: string) =>
          uri.endsWith('/v2/coins')
            ? { ok: true, status: 200, json: async () => [] }
            : { ok: false, status: 404, text: async () => unavailable }
      },
      initOptions: { apiKey: 'test-key' },
      log: Object.assign(() => {}, { warn() {} })
    } as unknown) as EdgeCorePluginOptions)

    await plugin
      .fetchSwapQuote(makeRequest(null, 'hypercore'), undefined, {
        infoPayload: {}
      })
      .then(
        () => assert.fail('expected SwapCurrencyError'),
        (error: unknown) => {
          assert.equal((error as Error).name, 'SwapCurrencyError')
        }
      )
  })
})
