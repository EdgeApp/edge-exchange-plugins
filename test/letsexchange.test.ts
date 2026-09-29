import { assert } from 'chai'
import {
  EdgeCurrencyWallet,
  EdgeSwapRequest,
  EdgeToken
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  MAINNET_CODE_TRANSCRIPTION,
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

const makeRequest = (toTokenId: string | null): EdgeSwapRequest => ({
  fromWallet: makeFakeWallet('ethereum', 'ETH'),
  toWallet: makeFakeWallet('hyperevm', 'HYPE'),
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

describe('LetsExchange HyperEVM codes', function () {
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

  it('never resolves a HyperEVM token against HyperCore', async function () {
    await getCodes(makeRequest('0xhypercoreusdc')).then(
      () => assert.fail('expected SwapCurrencyError'),
      (error: unknown) => {
        assert.equal((error as Error).name, 'SwapCurrencyError')
      }
    )
  })
})
