// Run: mocha -r sucrase/register --extension ts test/simpleswap.test.ts
import { assert } from 'chai'
import { beforeEach, describe, it } from 'mocha'

import { simpleswap } from '../src/mappings/simpleswap'
import { makeSimpleSwapPlugin } from '../src/swap/central/simpleswap'
import { edgeCurrencyPluginIds } from '../src/util/edgeCurrencyPluginIds'

const BTC_MULTIPLIER = '100000000' // 1e8
const ETH_MULTIPLIER = '1000000000000000000' // 1e18

interface FakeReply {
  status: number
  body: unknown
}
type FetchHandler = (url: string, method: string) => FakeReply

// Records the spendInfo the plugin hands to makeSpend so tests can inspect the
// deposit address, memos and savedAction without running the on-chain approve.
let capturedSpendInfo: any

const makeWallet = (
  pluginId: string,
  currencyCode: string,
  multiplier: string,
  publicAddress: string,
  id: string
): any => ({
  id,
  currencyInfo: {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  },
  // Edge's SwapCurrencyError reads currencyConfig.currencyInfo.pluginId
  currencyConfig: { currencyInfo: { pluginId }, allTokens: {} },
  balanceMap: new Map(),
  getAddresses: async () => [{ addressType: 'publicAddress', publicAddress }],
  makeSpend: async (spendInfo: any) => {
    capturedSpendInfo = spendInfo
    return {
      savedAction: spendInfo.savedAction,
      networkFee: '1000',
      currencyCode,
      txid: 'signed-txid'
    }
  }
})

const makeOpts = (handler: FetchHandler, apiKey = 'test-key'): any => ({
  initOptions: { apiKey },
  log: Object.assign(() => {}, { warn: () => {} }),
  io: {
    fetch: async (url: string, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET'
      const { status, body } = handler(url, method)
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body)
      }
    }
  }
})

const okReplies = {
  ranges: { result: { min: '0.001', max: '10' } },
  estimates: {
    result: {
      estimatedAmount: '0.05',
      rateId: 'rate-1',
      validUntil: '2030-01-01T00:00:00.000Z'
    }
  },
  exchanges: {
    result: {
      id: 'order-1',
      addressFrom: 'deposit-addr',
      amountFrom: '0.1',
      amountTo: '0.05'
    }
  }
}

const routeOf = (url: string): 'ranges' | 'estimates' | 'exchanges' => {
  if (url.includes('/ranges')) return 'ranges'
  if (url.includes('/estimates')) return 'estimates'
  return 'exchanges'
}

// Default handler: every hop succeeds.
const happyHandler: FetchHandler = url => ({
  status: 200,
  body: okReplies[routeOf(url)]
})

const btcWallet = (): any =>
  makeWallet('bitcoin', 'BTC', BTC_MULTIPLIER, 'btc-refund-addr', 'btc-wallet')
const ethWallet = (): any =>
  makeWallet('ethereum', 'ETH', ETH_MULTIPLIER, 'eth-payout-addr', 'eth-wallet')

const fromRequest = (): any => ({
  fromWallet: btcWallet(),
  toWallet: ethWallet(),
  fromTokenId: null,
  toTokenId: null,
  nativeAmount: '10000000', // 0.1 BTC
  quoteFor: 'from'
})

// Assert on error.name rather than instanceof: mocha may load this test as ESM
// while the plugin is required as CJS, giving edge-core-js two class identities.
const expectError = async (
  promise: Promise<unknown>,
  expectedName: string
): Promise<void> => {
  try {
    await promise
    assert.fail(`Expected ${expectedName} to be thrown`)
  } catch (error: any) {
    const name = error?.name ?? error?.constructor?.name
    assert.equal(name, expectedName)
  }
}

describe('simpleswap mapping', function () {
  it('maps majors to SimpleSwap network codes', function () {
    assert.equal(simpleswap.get('bitcoin'), 'btc')
    assert.equal(simpleswap.get('ethereum'), 'eth')
    assert.equal(simpleswap.get('binancesmartchain'), 'bsc')
    assert.equal(simpleswap.get('solana'), 'sol')
    assert.equal(simpleswap.get('litecoin'), 'ltc')
    assert.equal(simpleswap.get('tron'), 'trx')
  })

  it('maps unsupported chains and testnets to null (fail-loud, not mis-routed)', function () {
    assert.isNull(simpleswap.get('rsk'))
    assert.isNull(simpleswap.get('mayachain'))
    assert.isNull(simpleswap.get('bitcointestnet'))
    assert.isNull(simpleswap.get('sepolia'))
  })

  it('covers every EdgeCurrencyPluginId', function () {
    const unmappedPluginIds = edgeCurrencyPluginIds.filter(
      pluginId => !simpleswap.has(pluginId)
    )
    assert.deepEqual(unmappedPluginIds, [])
  })
})

describe('makeSimpleSwapPlugin.fetchSwapQuote', function () {
  beforeEach(function () {
    capturedSpendInfo = undefined
  })

  it('quotes a fixed-rate "from" swap and builds the spend', async function () {
    const plugin = makeSimpleSwapPlugin(makeOpts(happyHandler))
    const quote = await plugin.fetchSwapQuote(fromRequest(), undefined, {
      infoPayload: {}
    } as any)

    assert.equal(quote.pluginId, 'simpleswap')
    assert.equal(quote.fromNativeAmount, '10000000') // 0.1 BTC
    assert.equal(quote.toNativeAmount, '50000000000000000') // 0.05 ETH
    assert.equal(quote.isEstimate, false) // fixed-rate is locked

    const target = capturedSpendInfo.spendTargets[0]
    assert.equal(target.publicAddress, 'deposit-addr')
    assert.equal(target.nativeAmount, '10000000')

    const action = capturedSpendInfo.savedAction
    assert.equal(action.orderId, 'order-1')
    assert.equal(action.payoutAddress, 'eth-payout-addr')
    assert.equal(action.refundAddress, 'btc-refund-addr')
    assert.equal(action.isEstimate, false)
  })

  it('quotes a reverse "to" swap', async function () {
    const request = fromRequest()
    request.quoteFor = 'to'
    request.nativeAmount = '50000000000000000' // 0.05 ETH

    const plugin = makeSimpleSwapPlugin(makeOpts(happyHandler))
    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    } as any)

    assert.equal(quote.fromNativeAmount, '10000000')
    assert.equal(quote.toNativeAmount, '50000000000000000')
  })

  it('attaches a memo when the deposit address needs an extra id', async function () {
    const handler: FetchHandler = url => {
      if (routeOf(url) === 'exchanges') {
        return {
          status: 200,
          body: {
            result: {
              id: 'order-2',
              addressFrom: 'xrp-deposit',
              extraIdFrom: 'tag-123',
              amountFrom: '0.1',
              amountTo: '0.05'
            }
          }
        }
      }
      return { status: 200, body: okReplies[routeOf(url)] }
    }
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    await plugin.fetchSwapQuote(fromRequest(), undefined, {
      infoPayload: {}
    } as any)

    assert.deepEqual(capturedSpendInfo.memos, [
      { type: 'text', value: 'tag-123' }
    ])
  })

  it('throws SwapBelowLimitError under the range minimum', async function () {
    const handler: FetchHandler = url =>
      routeOf(url) === 'ranges'
        ? { status: 200, body: { result: { min: '1000', max: '10000' } } }
        : { status: 200, body: okReplies[routeOf(url)] }
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    await expectError(
      plugin.fetchSwapQuote(fromRequest(), undefined, {
        infoPayload: {}
      } as any),
      'SwapBelowLimitError'
    )
  })

  it('throws SwapAboveLimitError over the range maximum', async function () {
    const handler: FetchHandler = url =>
      routeOf(url) === 'ranges'
        ? { status: 200, body: { result: { min: '0.0001', max: '0.01' } } }
        : { status: 200, body: okReplies[routeOf(url)] }
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    await expectError(
      plugin.fetchSwapQuote(fromRequest(), undefined, {
        infoPayload: {}
      } as any),
      'SwapAboveLimitError'
    )
  })

  it('falls back to floating when the pair is unavailable fixed', async function () {
    const handler: FetchHandler = url => {
      if (url.includes('fixed=true')) return { status: 404, body: {} }
      if (routeOf(url) === 'estimates') {
        // Floating estimate carries no rateId
        return {
          status: 200,
          body: { result: { estimatedAmount: '0.05' } }
        }
      }
      return { status: 200, body: okReplies[routeOf(url)] }
    }
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    const quote = await plugin.fetchSwapQuote(fromRequest(), undefined, {
      infoPayload: {}
    } as any)

    assert.equal(quote.isEstimate, true) // floating is an estimate
    assert.equal(capturedSpendInfo.savedAction.isEstimate, true)
  })

  it('clamps a stale validUntil into the future', async function () {
    const handler: FetchHandler = url => {
      if (routeOf(url) === 'estimates') {
        return {
          status: 200,
          body: {
            result: {
              estimatedAmount: '0.05',
              rateId: 'rate-1',
              validUntil: '2020-01-01T00:00:00.000Z' // already expired
            }
          }
        }
      }
      return { status: 200, body: okReplies[routeOf(url)] }
    }
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    const quote = await plugin.fetchSwapQuote(fromRequest(), undefined, {
      infoPayload: {}
    } as any)

    assert.isDefined(quote.expirationDate)
    assert.isAtLeast(
      quote.expirationDate?.valueOf() ?? 0,
      Date.now() + 25 * 1000
    )
  })

  it('falls back to floating when the amount is below the fixed-rate minimum', async function () {
    const handler: FetchHandler = url => {
      if (routeOf(url) === 'ranges' && url.includes('fixed=true')) {
        // Fixed-rate minimum above the requested 0.1 BTC
        return { status: 200, body: { result: { min: '5', max: '10' } } }
      }
      if (routeOf(url) === 'estimates') {
        return { status: 200, body: { result: { estimatedAmount: '0.05' } } }
      }
      return { status: 200, body: okReplies[routeOf(url)] }
    }
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    const quote = await plugin.fetchSwapQuote(fromRequest(), undefined, {
      infoPayload: {}
    } as any)

    assert.equal(quote.isEstimate, true) // served by the floating flow
  })

  it('surfaces the fixed-rate limit error when floating lacks the pair', async function () {
    const handler: FetchHandler = url => {
      if (routeOf(url) === 'ranges') {
        if (url.includes('fixed=true')) {
          return { status: 200, body: { result: { min: '5', max: '10' } } }
        }
        return { status: 404, body: {} }
      }
      return { status: 200, body: okReplies[routeOf(url)] }
    }
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    try {
      await plugin.fetchSwapQuote(fromRequest(), undefined, {
        infoPayload: {}
      } as any)
      assert.fail('expected a limit error')
    } catch (error: unknown) {
      assert.equal((error as Error).name, 'SwapBelowLimitError')
    }
  })

  it('maps a 403 to SwapPermissionError (unverified key)', async function () {
    const handler: FetchHandler = () => ({ status: 403, body: {} })
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    await expectError(
      plugin.fetchSwapQuote(fromRequest(), undefined, {
        infoPayload: {}
      } as any),
      'SwapPermissionError'
    )
  })

  it('throws SwapCurrencyError for an unmapped chain before any request', async function () {
    let fetched = false
    const handler: FetchHandler = () => {
      fetched = true
      return { status: 200, body: {} }
    }
    const request = fromRequest()
    request.fromWallet = makeWallet(
      'rsk',
      'RBTC',
      ETH_MULTIPLIER,
      'rsk-addr',
      'rsk-wallet'
    )
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    await expectError(
      plugin.fetchSwapQuote(request, undefined, { infoPayload: {} } as any),
      'SwapCurrencyError'
    )
    assert.equal(fetched, false)
  })

  it('throws at factory time when apiKey is empty', function () {
    assert.throws(
      () => makeSimpleSwapPlugin(makeOpts(happyHandler, '')),
      'missing apiKey'
    )
  })

  it('creates exactly one order for a "max" quote (probe is quote-only)', async function () {
    const exchangeCalls: string[] = []
    const handler: FetchHandler = (url, method) => {
      if (method === 'POST') exchangeCalls.push(url)
      return { status: 200, body: okReplies[routeOf(url)] }
    }
    const request = fromRequest()
    request.quoteFor = 'max'
    request.fromWallet.balanceMap.set(null, '20000000') // 0.2 BTC on-chain
    let probeSpendInfo: any
    request.fromWallet.getMaxSpendable = async (
      spendInfo: any
    ): Promise<string> => {
      probeSpendInfo = spendInfo
      return '19000000' // balance minus fees
    }

    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    } as any)

    assert.equal(quote.fromNativeAmount, '10000000') // from create response
    assert.equal(exchangeCalls.length, 1)
    // The probe targets the user's own address and is never broadcast;
    // without skipChecks EVM engines reject it with SpendToSelfError.
    assert.equal(probeSpendInfo.skipChecks, true)
  })

  it('transcribes Edge currency codes to SimpleSwap tickers (BNB -> bnb-bsc)', async function () {
    const requestedUrls: string[] = []
    const handler: FetchHandler = url => {
      requestedUrls.push(url)
      return { status: 200, body: okReplies[routeOf(url)] }
    }
    const request = fromRequest()
    request.fromWallet = makeWallet(
      'binancesmartchain',
      'BNB',
      ETH_MULTIPLIER,
      'bsc-refund-addr',
      'bsc-wallet'
    )
    request.nativeAmount = '100000000000000000' // 0.1 BNB
    const plugin = makeSimpleSwapPlugin(makeOpts(handler))
    await plugin.fetchSwapQuote(request, undefined, { infoPayload: {} } as any)

    const rangesUrl = requestedUrls.find(url => url.includes('/ranges'))
    assert.include(rangesUrl, 'tickerFrom=bnb-bsc')
    assert.include(rangesUrl, 'networkFrom=bsc')
    assert.include(rangesUrl, 'tickerTo=eth')
  })
})
