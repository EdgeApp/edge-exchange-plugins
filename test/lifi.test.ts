import { assert } from 'chai'
import {
  EdgeSpendInfo,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTokenId
} from 'edge-core-js'
import { describe, it } from 'mocha'

import { decodeEvmApprovalData } from '../src/swap/defi/defiUtils'
import {
  checkLifiToken,
  checkQuotedAmount,
  getLifiAsset,
  LifiAsset,
  makeLifiPlugin,
  pullsFromWallet,
  toLifiAmount,
  toWalletAmounts
} from '../src/swap/defi/lifi'
import lifiArcQuotes from './lifiArcQuotes.json'

// Captured 2026-10-01 from https://li.quest/v1/quote, trimmed to the fields
// the plugin reads plus the token labels.
const { arcUsdcToEurc, baseUsdcToArcUsdc } = lifiArcQuotes

const ARC_INTERFACE = '0x3600000000000000000000000000000000000000'
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
const EURC_TOKEN_ID = 'bef5f6d51cb62b58e6a8f77868681825c6fe21c1'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const BASE_USDC_TOKEN_ID = '833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const OUR_ADDRESS = '0x8feec0972935bb18402d0031d448135f7e0a2813'
const APPROVAL_FEE = '1000000000000000'

const makeToken = (
  currencyCode: string,
  contractAddress: string,
  decimals: number
): any => ({
  currencyCode,
  denominations: [
    { name: currencyCode, multiplier: '1' + '0'.repeat(decimals) }
  ],
  displayName: currencyCode,
  networkLocation: { contractAddress }
})

const makeConfig = (
  pluginId: string,
  currencyCode: string,
  allTokens: { [tokenId: string]: unknown } = {}
): any => ({
  allTokens,
  currencyInfo: {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier: '1' + '0'.repeat(18) }]
  }
})

const arcConfig = makeConfig('arc', 'USDC', {
  [EURC_TOKEN_ID]: makeToken('EURC', EURC, 6)
})
const baseConfig = makeConfig('base', 'ETH', {
  [BASE_USDC_TOKEN_ID]: makeToken('USDC', BASE_USDC, 6)
})

const arcNative: LifiAsset = {
  address: ARC_INTERFACE,
  decimals: 6,
  scale: '1000000000000'
}
const arcEurc: LifiAsset = { address: EURC, decimals: 6, scale: '1' }
const baseEth: LifiAsset = { address: ZERO_ADDRESS, decimals: 18, scale: '1' }
const baseUsdc: LifiAsset = { address: BASE_USDC, decimals: 6, scale: '1' }

const expectThrow = (run: () => unknown, name: string): void => {
  let error: unknown
  try {
    run()
  } catch (e) {
    error = e
  }
  if (error == null) throw new Error(`Expected ${name}`)
  assert.equal((error as Error).name, name)
}

const expectRejection = async (
  promise: Promise<unknown>,
  check: (error: Error) => void
): Promise<void> => {
  let error: Error | undefined
  await promise.catch(e => {
    error = e
  })
  if (error == null) throw new Error('Expected a rejection')
  check(error)
}

describe('lifi getLifiAsset', function () {
  it("resolves Arc's native asset to the USDC interface at 6 decimals", function () {
    assert.deepEqual(getLifiAsset(arcConfig, null), arcNative)
  })

  it('resolves an ordinary native asset at wallet precision', function () {
    assert.deepEqual(getLifiAsset(baseConfig, null), baseEth)
  })

  it('resolves a token from its contract and denomination', function () {
    assert.deepEqual(getLifiAsset(arcConfig, EURC_TOKEN_ID), arcEurc)
    assert.deepEqual(getLifiAsset(baseConfig, BASE_USDC_TOKEN_ID), baseUsdc)
  })

  it('returns undefined for a token it cannot name', function () {
    assert.equal(getLifiAsset(baseConfig, 'missing'), undefined)
  })
})

describe('lifi toLifiAmount', function () {
  it('floors an 18-decimal amount to 6 decimals', function () {
    assert.equal(toLifiAmount('1234567891234567891', arcNative), '1234567')
    assert.equal(toLifiAmount('1999999999999', arcNative), '1')
  })

  it('throws SwapBelowLimitError below one interface unit', function () {
    expectThrow(
      () => toLifiAmount('999999999999', arcNative),
      'SwapBelowLimitError'
    )
  })

  it('leaves other assets unchanged', function () {
    assert.equal(
      toLifiAmount('1234567891234567891', baseEth),
      '1234567891234567891'
    )
    assert.equal(toLifiAmount('2500000', arcEurc), '2500000')
  })
})

describe('lifi toWalletAmounts', function () {
  it('scales fromAmount to 18 decimals when Arc is the source', function () {
    assert.deepEqual(
      toWalletAmounts(arcUsdcToEurc.estimate, arcNative, arcEurc),
      {
        fromAmount: '2500000000000000000',
        toAmount: arcUsdcToEurc.estimate.toAmount,
        toAmountMin: arcUsdcToEurc.estimate.toAmountMin
      }
    )
  })

  it('scales toAmount and toAmountMin when Arc is the destination', function () {
    assert.deepEqual(
      toWalletAmounts(baseUsdcToArcUsdc.estimate, baseUsdc, arcNative),
      {
        fromAmount: '2500000',
        toAmount: '2500000000000000000',
        toAmountMin: '2500000000000000000'
      }
    )
  })

  it('leaves amounts unchanged for other chains', function () {
    const estimate = {
      fromAmount: '100000000000000000',
      toAmount: '270137022',
      toAmountMin: '268786337'
    }
    assert.deepEqual(toWalletAmounts(estimate, baseEth, baseUsdc), estimate)
  })
})

describe('lifi checkLifiToken', function () {
  const request: any = {
    fromWallet: { currencyConfig: arcConfig },
    toWallet: { currencyConfig: arcConfig },
    fromTokenId: null,
    toTokenId: EURC_TOKEN_ID
  }

  it('passes the tokens of a real Arc quote', function () {
    checkLifiToken(arcUsdcToEurc.action.fromToken, arcNative, request)
    checkLifiToken(arcUsdcToEurc.action.toToken, arcEurc, request)
    checkLifiToken(baseUsdcToArcUsdc.action.fromToken, baseUsdc, request)
    checkLifiToken(baseUsdcToArcUsdc.action.toToken, arcNative, request)
  })

  it('ignores address case', function () {
    checkLifiToken(
      { address: EURC.toLowerCase(), decimals: 6 },
      arcEurc,
      request
    )
  })

  it('fails when LI.FI priced the asset at other decimals', function () {
    expectThrow(
      () =>
        checkLifiToken(
          { address: ARC_INTERFACE, decimals: 18 },
          arcNative,
          request
        ),
      'SwapCurrencyError'
    )
  })

  it('fails when LI.FI priced another token', function () {
    expectThrow(
      () =>
        checkLifiToken(
          { address: ZERO_ADDRESS, decimals: 6 },
          arcNative,
          request
        ),
      'SwapCurrencyError'
    )
  })
})

describe('lifi pullsFromWallet', function () {
  it('pulls a native asset when the call sends no value', function () {
    assert.equal(pullsFromWallet(null, '0x0'), true)
    assert.equal(pullsFromWallet(null, '0x00'), true)
  })

  it('sends a native asset as value when the call carries one', function () {
    assert.equal(pullsFromWallet(null, '0x16345785d8a0000'), false)
  })

  it('always pulls a token', function () {
    assert.equal(pullsFromWallet(EURC_TOKEN_ID, '0x0'), true)
    assert.equal(pullsFromWallet(EURC_TOKEN_ID, '0x16345785d8a0000'), true)
  })
})

describe('lifi checkQuotedAmount', function () {
  it('accepts a quote at or below the requested amount', function () {
    checkQuotedAmount('2500000', '2500000')
    checkQuotedAmount('2499999', '2500000')
  })

  it('throws on a quote above the requested amount', function () {
    assert.throws(
      () => checkQuotedAmount('2500001', '2500000'),
      'LI.FI quoted 2500001, above the requested 2500000'
    )
  })
})

describe('lifi fetchSwapQuote', function () {
  interface Harness {
    quoteUrls: string[]
    spends: EdgeSpendInfo[]
    fetchQuote: (
      nativeAmount: string,
      fromTokenId?: EdgeTokenId
    ) => Promise<EdgeSwapQuote>
    fetchMaxQuote: (maxSpendable: string) => Promise<EdgeSwapQuote>
  }

  /** A deep copy of the captured Arc USDC to EURC quote, edited by `edit` */
  const arcQuote = (
    edit: (quote: typeof arcUsdcToEurc) => void = () => {}
  ): typeof arcUsdcToEurc => {
    const quote: typeof arcUsdcToEurc = JSON.parse(
      JSON.stringify(arcUsdcToEurc)
    )
    edit(quote)
    return quote
  }

  const makeHarness = (quoteJson: unknown, balance: string): Harness => {
    const quoteUrls: string[] = []
    const spends: EdgeSpendInfo[] = []
    let maxSpendable = '0'

    const fetch = async (url: string): Promise<unknown> => {
      if (url.includes('v1/quote')) {
        quoteUrls.push(url)
        return { ok: true, json: async () => quoteJson }
      }
      // The info server is optional, and the plugin falls back to defaults:
      return { ok: false, text: async () => 'not found' }
    }

    const wallet: any = {
      id: 'arcWallet',
      balanceMap: new Map([[null, balance]]),
      currencyConfig: arcConfig,
      currencyInfo: arcConfig.currencyInfo,
      getAddresses: async () => [{ publicAddress: OUR_ADDRESS }],
      getMaxSpendable: async () => maxSpendable,
      makeSpend: async (spendInfo: EdgeSpendInfo) => {
        spends.push(spendInfo)
        return {
          networkFee: APPROVAL_FEE,
          savedAction: spendInfo.savedAction
        }
      }
    }

    const plugin = makeLifiPlugin({
      initOptions: {},
      io: { fetch, fetchCors: fetch },
      log: { warn: () => {} }
    } as any)

    const fetchQuote = async (
      nativeAmount: string,
      fromTokenId: EdgeTokenId = null
    ): Promise<EdgeSwapQuote> => {
      const request: EdgeSwapRequest = {
        fromWallet: wallet,
        toWallet: wallet,
        fromTokenId,
        toTokenId: fromTokenId == null ? EURC_TOKEN_ID : null,
        nativeAmount,
        quoteFor: 'from'
      }
      return await plugin.fetchSwapQuote(request, undefined, {
        infoPayload: {},
        promoCode: undefined
      })
    }

    /** A max request, where the engine reports `amount` as spendable */
    const fetchMaxQuote = async (amount: string): Promise<EdgeSwapQuote> => {
      maxSpendable = amount
      const request: EdgeSwapRequest = {
        fromWallet: wallet,
        toWallet: wallet,
        fromTokenId: null,
        toTokenId: EURC_TOKEN_ID,
        nativeAmount: '0',
        quoteFor: 'max'
      }
      return await plugin.fetchSwapQuote(request, undefined, {
        infoPayload: {},
        promoCode: undefined
      })
    }

    return { quoteUrls, spends, fetchQuote, fetchMaxQuote }
  }

  it('pulls Arc USDC through an approval when the call sends no value', async function () {
    const { quoteUrls, spends, fetchQuote } = makeHarness(
      arcQuote(),
      '10000000000000000000'
    )
    const quote = await fetchQuote('2500000999999999999')

    // The request floors to LI.FI's 6 decimals:
    assert.equal(quoteUrls.length, 1)
    assert.include(quoteUrls[0], `fromToken=${ARC_INTERFACE}&`)
    assert.include(quoteUrls[0], '&fromAmount=2500000&')

    // The quote reports what the swap actually moves, in wallet units:
    assert.equal(quote.fromNativeAmount, '2500000000000000000')
    assert.equal(quote.toNativeAmount, '2223760')
    assert.equal(quote.minReceiveAmount, '2221536')

    assert.equal(spends.length, 2)
    const [approval, swap] = spends

    // The interface contract reads the allowance in its own 6 decimals,
    // while the saved action shows the wallet's 18:
    assert.equal(approval.spendTargets[0].publicAddress, ARC_INTERFACE)
    assert.equal(approval.spendTargets[0].nativeAmount, '0')
    assert.deepEqual(
      decodeEvmApprovalData(`0x${String(approval.memos?.[0].value)}`),
      {
        spendingAddress: arcUsdcToEurc.estimate.approvalAddress,
        nativeAmount: '2500000'
      }
    )
    if (approval.savedAction?.actionType !== 'tokenApproval') {
      throw new Error('Expected a tokenApproval action')
    }
    assert.equal(
      approval.savedAction.tokenApproved.nativeAmount,
      '2500000000000000000'
    )

    // The call itself sends no value:
    assert.equal(swap.spendTargets[0].nativeAmount, '0')
    assert.equal(swap.pendingTxs?.length, 1)
    if (swap.savedAction?.actionType !== 'swap') {
      throw new Error('Expected a swap action')
    }
    assert.equal(swap.savedAction.fromAsset.nativeAmount, '2500000000000000000')
    assert.equal(swap.savedAction.toAsset.nativeAmount, '2223760')
  })

  it('sends Arc USDC as value, with no approval, when the call carries one', async function () {
    const { spends, fetchQuote } = makeHarness(
      arcQuote(quote => {
        quote.transactionRequest.value = '0x22b1c8c1227a0000'
      }),
      '10000000000000000000'
    )
    const quote = await fetchQuote('2500000000000000000')

    assert.equal(quote.fromNativeAmount, '2500000000000000000')
    assert.equal(spends.length, 1)
    assert.equal(spends[0].spendTargets[0].nativeAmount, '2500000000000000000')
    assert.equal(spends[0].savedAction?.actionType, 'swap')
  })

  it('approves a token at the same amount it saves', async function () {
    const { quoteUrls, spends, fetchQuote } = makeHarness(
      arcQuote(quote => {
        const { fromToken, toToken } = quote.action
        quote.action.fromToken = toToken
        quote.action.toToken = fromToken
      }),
      '10000000000000000000'
    )
    const quote = await fetchQuote('2500000', EURC_TOKEN_ID)

    assert.include(quoteUrls[0], '&fromAmount=2500000&')
    assert.equal(quote.fromNativeAmount, '2500000')
    // The destination is Arc's native USDC, so it scales up to 18 decimals:
    assert.equal(quote.toNativeAmount, '2223760000000000000')
    assert.equal(quote.minReceiveAmount, '2221536000000000000')

    assert.equal(spends.length, 2)
    const [approval, swap] = spends
    assert.equal(approval.spendTargets[0].publicAddress, EURC)
    assert.equal(
      decodeEvmApprovalData(`0x${String(approval.memos?.[0].value)}`)
        .nativeAmount,
      '2500000'
    )
    if (approval.savedAction?.actionType !== 'tokenApproval') {
      throw new Error('Expected a tokenApproval action')
    }
    assert.equal(approval.savedAction.tokenApproved.nativeAmount, '2500000')
    // A token is spent as a token transfer of the full amount:
    assert.equal(swap.tokenId, EURC_TOKEN_ID)
    assert.equal(swap.spendTargets[0].nativeAmount, '2500000')
  })

  it('fails a quote whose action token disagrees with the request', async function () {
    const { spends, fetchQuote } = makeHarness(
      arcQuote(quote => {
        quote.action.fromToken.decimals = 18
      }),
      '10000000000000000000'
    )
    await expectRejection(fetchQuote('2500000000000000000'), error => {
      assert.equal(error.name, 'SwapCurrencyError')
    })
    assert.equal(spends.length, 0)
  })

  it('fails a quote that pulls more than was requested', async function () {
    const { spends, fetchQuote } = makeHarness(
      arcQuote(quote => {
        quote.estimate.fromAmount = '2500001'
      }),
      '10000000000000000000'
    )
    await expectRejection(fetchQuote('2500000000000000000'), error => {
      assert.equal(
        error.message,
        'LI.FI quoted 2500001, above the requested 2500000'
      )
    })
    assert.equal(spends.length, 0)
  })

  it('throws SwapBelowLimitError before quoting a sub-unit amount', async function () {
    const { quoteUrls, fetchQuote } = makeHarness(
      arcQuote(),
      '10000000000000000000'
    )
    await expectRejection(fetchQuote('999999999999'), error => {
      assert.equal(error.name, 'SwapBelowLimitError')
    })
    assert.equal(quoteUrls.length, 0)
  })

  it('throws InsufficientFundsError when a pulled swap cannot cover its fees', async function () {
    // Exactly the swap amount, with nothing left for either network fee:
    const { fetchQuote } = makeHarness(arcQuote(), '2500000000000000000')
    await expectRejection(fetchQuote('2500000000000000000'), error => {
      assert.equal(error.name, 'InsufficientFundsError')
    })
  })

  it('quotes a max swap that leaves room for its fees', async function () {
    const { quoteUrls, fetchMaxQuote } = makeHarness(
      arcQuote(),
      '10000000000000000000'
    )
    // The engine leaves the swap fee, and the plugin the approval fee:
    const quote = await fetchMaxQuote('2501000000000000000')

    assert.equal(quoteUrls.length, 2)
    assert.include(quoteUrls[0], '&fromAmount=10000000&')
    assert.include(quoteUrls[1], '&fromAmount=2500000&')
    assert.equal(quote.fromNativeAmount, '2500000000000000000')
  })

  it('checks the balance on the quote a max swap returns', async function () {
    // The balance covers the amount, but not the fees the final quote names:
    const { fetchMaxQuote } = makeHarness(arcQuote(), '2500000000000000001')
    await expectRejection(fetchMaxQuote('2501000000000000000'), error => {
      assert.equal(error.name, 'InsufficientFundsError')
    })
  })
})
