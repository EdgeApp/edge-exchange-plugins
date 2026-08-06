import { sub } from 'biggystring'
import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapPlugin,
  EdgeSwapRequest,
  EdgeTransaction
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeTemplatePlugin } from '../src/swap/central/template'

/**
 * `template.ts` is never registered in `src/index.ts`, so nothing exercises it
 * at runtime. It is still the file every new provider integration is told to
 * copy, which makes each construct in it a claim about what a correct plugin
 * does. These tests are what make those claims checkable, and they double as
 * the starting test suite a new integration can copy alongside the template.
 *
 * Each case below corresponds to a defect that reached review on a shipped
 * provider PR.
 */

// Checksummed EVM address. Edge's Ethereum engine stores this exact string as
// `walletLocalData.publicKey` AND returns it from `getAddresses`, so a spend
// targeting the user's own address is indistinguishable from a spend to self.
const ETH_ADDRESS = '0x9A5c4A9F9E6f3fC7f8E1B8B0C9d5e6A7B8C9d0E1'
const XRP_ADDRESS = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'
const DEPOSIT_ADDRESS = '0x1111111111111111111111111111111111111111'
const USDC_TOKEN_ID = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
/** On the shared `defaultInvalidCodes` list in `swapHelpers.ts`. */
const REP_TOKEN_ID = '1985365e9f78359a9b6ad760e32412f4a445e862'

const ETH_MULTIPLIER = '1000000000000000000'
const XRP_MULTIPLIER = '1000000'
const USDC_MULTIPLIER = '1000000'

const ETH_BALANCE = '1000000000000000000' // 1 ETH
const ETH_FEE = '196600000000000'
const USDC_BALANCE = '14009000' // 14.009 USDC

/**
 * Mirrors the `SpendToSelfError` guard in edge-currency-accountbased's
 * `makeSpendCheck`, which runs before every engine spend estimate. The max
 * probe targets the user's own address, so without `skipChecks` this fires.
 */
class SpendToSelfError extends Error {
  name = 'SpendToSelfError'
  constructor() {
    super('Spend to self')
  }
}

interface FakeWalletOpts {
  pluginId: string
  currencyCode: string
  address: string
  multiplier: string
  evmChainId?: number
  balanceMap?: Map<string | null, string>
  /** Records every spend the plugin asks the engine to price. */
  spendLog?: EdgeSpendInfo[]
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const {
    address,
    balanceMap = new Map(),
    currencyCode,
    evmChainId,
    multiplier,
    pluginId,
    spendLog = []
  } = opts

  const checkSpend = (spendInfo: EdgeSpendInfo): void => {
    spendLog.push(spendInfo)
    const { skipChecks = false } = spendInfo
    for (const spendTarget of spendInfo.spendTargets) {
      if (!skipChecks && spendTarget.publicAddress === address) {
        throw new SpendToSelfError()
      }
    }
  }

  const currencyInfo = {
    pluginId,
    currencyCode,
    evmChainId,
    denominations: [{ name: currencyCode, multiplier }]
  }

  return ({
    id: `${pluginId}-wallet`,
    balanceMap,
    currencyInfo,
    currencyConfig: {
      // `SwapCurrencyError` reads the pluginId through here.
      currencyInfo,
      allTokens: {
        [USDC_TOKEN_ID]: {
          currencyCode: 'USDC',
          denominations: [{ name: 'USDC', multiplier: USDC_MULTIPLIER }],
          networkLocation: { contractAddress: `0x${USDC_TOKEN_ID}` }
        },
        [REP_TOKEN_ID]: {
          currencyCode: 'REP',
          denominations: [{ name: 'REP', multiplier: ETH_MULTIPLIER }],
          networkLocation: { contractAddress: `0x${REP_TOKEN_ID}` }
        }
      }
    },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo) {
      checkSpend(spendInfo)
      const balance = balanceMap.get(spendInfo.tokenId) ?? '0'
      // Matches the Ethereum engine: the token branch spends the whole token
      // balance (the fee comes out of the parent currency), while the native
      // branch holds back the network fee.
      return spendInfo.tokenId == null ? sub(balance, ETH_FEE) : balance
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      checkSpend(spendInfo)
      return ({
        networkFee: '0',
        parentNetworkFee: ETH_FEE,
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      } as unknown) as EdgeTransaction
    }
  } as unknown) as EdgeCurrencyWallet
}

interface FakeIoOpts {
  /** Extra fields merged onto every successful quote body. */
  quoteExtra?: Record<string, unknown>
  /** Extra fields merged onto every successful order body. */
  orderExtra?: Record<string, unknown>
  /** When set, the quote endpoint answers with this structured error body. */
  quoteErrors?: unknown[]
  /** Records `<endpoint> <json body>` for every request the plugin sends. */
  requestLog?: string[]
}

/**
 * A two-endpoint provider: `getQuote` prices, `createOrder` commits. The quote
 * echoes the requested amount back, as a real provider does, so a max swap's
 * second (post-`getMaxSpendable`) quote reports the trimmed amount.
 *
 * Keeping these separate is what lets a test assert that the max probe created
 * nothing, rather than merely counting calls.
 */
const makeFakeIo = (opts: FakeIoOpts = {}): { fetch: Function } => {
  const {
    orderExtra = {},
    quoteErrors,
    quoteExtra = {},
    requestLog = []
  } = opts
  const expirationIsoDate = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  let lastQuoteAmounts = { sourceAmount: '0.5', destinationAmount: '1200' }

  return {
    fetch: async (uri: string, fetchOpts: { body: string }) => {
      const endpoint = uri.split('/').pop() ?? ''
      const sent = JSON.parse(fetchOpts.body)
      requestLog.push(`${endpoint} ${fetchOpts.body}`)

      let body: Record<string, unknown>
      if (endpoint === 'createOrder') {
        body = {
          orderId: 'order-1',
          depositAddress: DEPOSIT_ADDRESS,
          ...lastQuoteAmounts,
          ...orderExtra
        }
      } else if (quoteErrors != null) {
        body = { errors: quoteErrors }
      } else {
        lastQuoteAmounts = {
          sourceAmount: sent.sourceAmount ?? '0.5',
          destinationAmount: sent.destinationAmount ?? '1200'
        }
        body = {
          quoteId: 'quote-1',
          ...lastQuoteAmounts,
          expirationIsoDate,
          ...quoteExtra
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body)
      }
    }
  }
}

/** Count how many times the plugin hit a given endpoint. */
const countCalls = (requestLog: string[], endpoint: string): number =>
  requestLog.filter(entry => entry.startsWith(`${endpoint} `)).length

const makePlugin = (opts: FakeIoOpts = {}): EdgeSwapPlugin =>
  makeTemplatePlugin(({
    io: makeFakeIo(opts),
    initOptions: { apiKey: 'test-key' },
    log: Object.assign(() => {}, { warn() {} })
  } as unknown) as EdgeCorePluginOptions)

const makeEthWallet = (
  balanceMap: Map<string | null, string>,
  spendLog?: EdgeSpendInfo[]
): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'ethereum',
    currencyCode: 'ETH',
    address: ETH_ADDRESS,
    multiplier: ETH_MULTIPLIER,
    evmChainId: 1,
    balanceMap,
    spendLog
  })

const makeXrpWallet = (spendLog?: EdgeSpendInfo[]): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'ripple',
    currencyCode: 'XRP',
    address: XRP_ADDRESS,
    multiplier: XRP_MULTIPLIER,
    spendLog
  })

describe('template max quotes', function () {
  it('probes without spending to self, so EVM max swaps work', async function () {
    // Regression shape: a probe whose spendInfo omits `skipChecks` targets the
    // user's own address, and every EVM engine rejects that with
    // `SpendToSelfError`, failing max swaps that normal swaps handle fine.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin()
    const fromWallet = makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog)

    const request: EdgeSwapRequest = {
      fromWallet,
      fromTokenId: null,
      toWallet: makeXrpWallet(),
      toTokenId: null,
      nativeAmount: ETH_BALANCE,
      quoteFor: 'max'
    }

    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    const probeSpend = spendLog[0]
    assert.equal(
      probeSpend.skipChecks,
      true,
      'the max probe must set skipChecks'
    )
    assert.equal(probeSpend.spendTargets[0].publicAddress, ETH_ADDRESS)
    // The quote is sized to the balance minus the network fee, not the raw
    // balance the request arrived with.
    assert.equal(quote.fromNativeAmount, sub(ETH_BALANCE, ETH_FEE))
  })

  it('creates exactly one order across a max swap', async function () {
    // Regression shape: when order creation sits in the probed path, every max
    // swap creates and abandons a live order at the provider. Counting total
    // requests would NOT catch that, since the probe legitimately quotes twice.
    // Assert on the order endpoint specifically.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await plugin.fetchSwapQuote(
      {
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        fromTokenId: null,
        toWallet: makeXrpWallet(),
        toTokenId: null,
        nativeAmount: ETH_BALANCE,
        quoteFor: 'max'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.equal(countCalls(requestLog, 'getQuote'), 2, 'probe + real quote')
    assert.equal(
      countCalls(requestLog, 'createOrder'),
      1,
      'the probe must create nothing; only the real pass orders'
    )
    // The order is created from the trimmed amount, after the probe priced fees.
    const orderCall = requestLog.find(e => e.startsWith('createOrder '))
    assert.isDefined(orderCall)
  })

  it('creates no order at all when the probe itself fails', async function () {
    // If the probe path could order, a pair the provider rejects would still
    // leave a live order behind.
    const requestLog: string[] = []
    const plugin = makePlugin({
      requestLog,
      quoteErrors: [{ code: 'CURRENCY_UNSUPPORTED', message: 'no route' }]
    })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            fromTokenId: null,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: ETH_BALANCE,
            quoteFor: 'max'
          },
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )

    assert.equal(countCalls(requestLog, 'createOrder'), 0)
  })

  it('clamps an above-limit balance instead of throwing', async function () {
    // Regression shape: the probe quotes the full PRE-FEE balance, so throwing
    // SwapAboveLimitError there aborts a max swap that fits once fees come out.
    const plugin = makePlugin({
      quoteExtra: {
        // Ceiling sits between the raw balance and the fee-trimmed amount.
        sourceAmountMax: '0.9999'
      }
    })

    const quote = await plugin.fetchSwapQuote(
      {
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        fromTokenId: null,
        toWallet: makeXrpWallet(),
        toTokenId: null,
        nativeAmount: ETH_BALANCE,
        quoteFor: 'max'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.equal(quote.fromNativeAmount, sub(ETH_BALANCE, ETH_FEE))
  })

  it('still throws above-limit on an explicit from request', async function () {
    const plugin = makePlugin({ quoteExtra: { sourceAmountMax: '0.25' } })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            fromTokenId: null,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: '500000000000000000', // 0.5 ETH
            quoteFor: 'from'
          },
          undefined,
          { infoPayload: {} }
        ),
      'SwapAboveLimitError'
    )
  })
})

describe('template limits', function () {
  it('enforces limits against the requested amount, not the echo', async function () {
    // Regression shape: a provider that silently CLAMPS an out-of-range request
    // returns an in-range echo, so comparing the echo lets the swap proceed for
    // less than the user asked.
    const plugin = makePlugin({
      quoteExtra: {
        sourceAmountMin: '0.25',
        // The echo is in range even though the request is not.
        sourceAmount: '0.25'
      }
    })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            fromTokenId: null,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: '10000000000000000', // 0.01 ETH, below the 0.25 floor
            quoteFor: 'from'
          },
          undefined,
          { infoPayload: {} }
        ),
      'SwapBelowLimitError'
    )
  })

  it('rounds a minimum limit up to whole native units', async function () {
    // Regression shape: `denominationToNative` is a plain multiply, so a limit
    // with more decimals than the asset yields a fraction. Rounding a floor
    // DOWN would also let an amount under the provider's real minimum through.
    const plugin = makePlugin({
      // 6-decimal XRP: 0.0000015 XRP is 1.5 drops.
      quoteExtra: { destinationAmountMin: '0.0000015' }
    })

    const error = await captureRejection(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            fromTokenId: null,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: '1', // 1 drop, below the rounded-up 2-drop floor
            quoteFor: 'to'
          },
          undefined,
          { infoPayload: {} }
        )
    )

    assert.equal(error.name, 'SwapBelowLimitError')
    assert.equal(
      ((error as unknown) as { nativeMin: string }).nativeMin,
      '2',
      'a 1.5-drop floor must round UP to 2 drops, never down to 1'
    )
  })

  it('reads a limit error from the pinned side, not the error kind', async function () {
    // The wallet and tokenId used for the conversion are the PINNED side's, so
    // the amount has to come from that side too. Picking the field by
    // below-vs-above instead converts through the wrong denomination and
    // reports a limit wrong by the ratio between the two assets.
    const plugin = makePlugin({
      quoteErrors: [
        {
          code: 'ABOVE_LIMIT',
          message: 'amount too high',
          sourceLimitAmount: '0.25', // ETH, the pinned side on a `from` quote
          destinationLimitAmount: '900' // XRP, the other side
        }
      ]
    })

    const error = await captureRejection(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            fromTokenId: null,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: '500000000000000000',
            quoteFor: 'from'
          },
          undefined,
          { infoPayload: {} }
        )
    )

    assert.equal(error.name, 'SwapAboveLimitError')
    assert.equal(
      ((error as unknown) as { nativeMax: string }).nativeMax,
      '250000000000000000', // 0.25 ETH in wei
      'the ceiling must be the SOURCE limit read in ETH, not the XRP one'
    )
  })

  it('ranks multiple errors by priority, not array order', async function () {
    // The API returns every applicable error at once, so the plugin picks. The
    // documented order is region, then currency, then limit. Here the limit
    // error arrives LAST in the array and the currency error must still win —
    // ranking that follows array order silently changes with the provider.
    const plugin = makePlugin({
      quoteErrors: [
        { code: 'CURRENCY_UNSUPPORTED', message: 'no route for this pair' },
        {
          code: 'BELOW_LIMIT',
          message: 'amount too low',
          sourceLimitAmount: '0.25',
          destinationLimitAmount: '100'
        }
      ]
    })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            fromTokenId: null,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: '10000000000000000',
            quoteFor: 'from'
          },
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )
  })
})

describe('template trust boundary', function () {
  it('rejects a source amount above the requested amount', async function () {
    // Regression shape: the provider's amount becomes a SIGNED SPEND, so an
    // inflated response can move more of the source asset than was quoted.
    const plugin = makePlugin({
      orderExtra: { sourceAmount: '0.9' } // request below asks for 0.5
    })

    const error = await captureRejection(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            fromTokenId: null,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: '500000000000000000', // 0.5 ETH
            quoteFor: 'from'
          },
          undefined,
          { infoPayload: {} }
        )
    )

    assert.include(error.message, 'above the requested amount')
  })

  it('builds the order URI from the plugin constant', async function () {
    // Regression shape: a partner-supplied `statusUrl` persisted into
    // `orderUri` renders as a tappable link, so a compromised upstream could
    // steer users anywhere.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({
      orderExtra: { statusUrl: 'https://evil.example/steal' }
    })

    await plugin.fetchSwapQuote(
      {
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog),
        fromTokenId: null,
        toWallet: makeXrpWallet(),
        toTokenId: null,
        nativeAmount: '500000000000000000',
        quoteFor: 'from'
      },
      undefined,
      { infoPayload: {} }
    )

    const { savedAction } = spendLog[0]
    if (savedAction?.actionType !== 'swap') throw new Error('expected a swap')
    assert.equal(savedAction.orderUri, 'https://example.com/?orderId=order-1')
  })
})

describe('template cleaners', function () {
  it('keeps a numeric deposit memo', async function () {
    // Regression shape: `asOptional(asString)` drops a NUMERIC memo, which is
    // the common shape for an XRP destination tag, and the deposit then goes
    // out untagged. That loses funds on memo-based chains.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({ orderExtra: { depositExtraId: 1234567890 } })

    await plugin.fetchSwapQuote(
      {
        fromWallet: makeXrpWallet(spendLog),
        fromTokenId: null,
        toWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        toTokenId: null,
        nativeAmount: '10000000',
        quoteFor: 'from'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.deepEqual(spendLog[0].memos, [
      { type: 'number', value: '1234567890' }
    ])
  })

  it('keeps the XRP destination tag 0', async function () {
    // `0` is a valid destination tag, and is the value most likely to be lost
    // to a truthiness check somewhere along the way.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({ orderExtra: { depositExtraId: 0 } })

    await plugin.fetchSwapQuote(
      {
        fromWallet: makeXrpWallet(spendLog),
        fromTokenId: null,
        toWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        toTokenId: null,
        nativeAmount: '10000000',
        quoteFor: 'from'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.deepEqual(spendLog[0].memos, [{ type: 'number', value: '0' }])
  })

  it('treats a blank deposit memo as absent', async function () {
    // Regression shape: an empty string becomes an empty `EdgeMemo`, which can
    // break fee estimation or broadcast on memo-sensitive chains.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({ orderExtra: { depositExtraId: '' } })

    await plugin.fetchSwapQuote(
      {
        fromWallet: makeXrpWallet(spendLog),
        fromTokenId: null,
        toWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        toTokenId: null,
        nativeAmount: '10000000',
        quoteFor: 'from'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.deepEqual(spendLog[0].memos, [], 'a blank memo must become no memo')
  })
})

describe('template guards', function () {
  it('rejects a same-asset swap before any network call', async function () {
    // Regression shape: skipping `checkInvalidTokenIds` lets a self-swap and
    // every blocked asset reach the partner API.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })
    const wallet = makeEthWallet(new Map([[null, ETH_BALANCE]]))

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: wallet,
            fromTokenId: null,
            toWallet: wallet,
            toTokenId: null,
            nativeAmount: '500000000000000000',
            quoteFor: 'from'
          },
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0, 'no request should reach the provider')
  })

  it('rejects the shared blocked-token list', async function () {
    const plugin = makePlugin()
    const wallet = makeEthWallet(
      new Map([
        [null, ETH_BALANCE],
        [USDC_TOKEN_ID, USDC_BALANCE]
      ])
    )

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          {
            fromWallet: wallet,
            fromTokenId: REP_TOKEN_ID,
            toWallet: makeXrpWallet(),
            toTokenId: null,
            nativeAmount: '500000000000000000',
            quoteFor: 'from'
          },
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )
  })

  it('reports a floating rate as an estimate', async function () {
    // Regression shape: hardcoding `isEstimate: false` shows the user a LOCKED
    // receive amount on a floating route.
    const plugin = makePlugin() // no isFixedRate: defaults to floating

    const quote = await plugin.fetchSwapQuote(
      {
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        fromTokenId: null,
        toWallet: makeXrpWallet(),
        toTokenId: null,
        nativeAmount: '500000000000000000',
        quoteFor: 'from'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.equal(quote.isEstimate, true)
  })

  it('reports a fixed rate as guaranteed', async function () {
    const plugin = makePlugin({ quoteExtra: { isFixedRate: true } })

    const quote = await plugin.fetchSwapQuote(
      {
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        fromTokenId: null,
        toWallet: makeXrpWallet(),
        toTokenId: null,
        nativeAmount: '500000000000000000',
        quoteFor: 'from'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.equal(quote.isEstimate, false)
  })
})

/** Assert that `fn` rejects with an error whose `name` matches. */
const assertRejects = async (
  fn: () => Promise<unknown>,
  errorName: string
): Promise<void> => {
  const error = await captureRejection(fn)
  assert.equal(error.name, errorName, `got: ${error.name}: ${error.message}`)
}

/** Run `fn`, returning the error it rejected with, or failing if it resolved. */
const captureRejection = async (fn: () => Promise<unknown>): Promise<Error> => {
  try {
    await fn()
  } catch (error: unknown) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('expected a rejection, but the call resolved')
}
