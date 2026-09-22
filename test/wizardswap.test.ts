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

import { makeWizardSwapPlugin } from '../src/swap/central/wizardswap'

/**
 * WizardSwap prices and orders over two endpoints that answer in shapes no
 * other Edge provider uses: a quote failure arrives as PROSE inside the same
 * `estimated_amount` field that carries a successful amount, or as a bare
 * `false`, and every body is prefixed with a literal tab before the JSON.
 *
 * These cases pin the behavior that is easy to get wrong precisely because the
 * provider gives no structured error, no limits endpoint, and no maximum.
 */

// Checksummed EVM address. Edge's Ethereum engine stores this exact string as
// `walletLocalData.publicKey` AND returns it from `getAddresses`, so a spend
// targeting the user's own address is indistinguishable from a spend to self.
const ETH_ADDRESS = '0x9A5c4A9F9E6f3fC7f8E1B8B0C9d5e6A7B8C9d0E1'
const XMR_ADDRESS =
  '48jewbtxe4jU3MnzJFjTs3gVFWh2nBwYiEo5bqpVtQTaGCvpg7ZZvLBMLuisXFoZKvWJDJgCJTaGYAgfVLmmvC7CCS9Y2Nu'
const ZEC_TRANSPARENT_ADDRESS = 't1KsNMuN5mKhKPMLVKVvLqNGJ4KBRvBVQhL'
const ZEC_UNIFIED_ADDRESS =
  'u1lmfjm8jsvtl5u6yd8s4hmsaprkcgmm8cs4q3vr7dwzgtcxpqmn9zqlwqmnkr'
const DEPOSIT_ADDRESS = '0x1111111111111111111111111111111111111111'
const USDC_TOKEN_ID = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const ETH_MULTIPLIER = '1000000000000000000'
const XMR_MULTIPLIER = '1000000000000'
const ZEC_MULTIPLIER = '100000000'
const USDC_MULTIPLIER = '1000000'

const ETH_BALANCE = '1000000000000000000' // 1 ETH
const ETH_FEE = '196600000000000'
const USDC_BALANCE = '14009000' // 14.009 USDC
const HALF_ETH = '500000000000000000'

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
  /** Extra entries prepended to `getAddresses`, ahead of the plain one. */
  extraAddresses?: Array<{ addressType: string; publicAddress: string }>
  balanceMap?: Map<string | null, string>
  /** Records every spend the plugin asks the engine to price. */
  spendLog?: EdgeSpendInfo[]
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const {
    address,
    balanceMap = new Map(),
    currencyCode,
    extraAddresses = [],
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
        }
      }
    },
    async getAddresses() {
      // The primary address comes first, which is what an engine returns and
      // what a plugin gets when it does not ask for a type. Ordering the
      // extras last is what makes the Zcash payout test bite: pick the first
      // address and you get the unified one WizardSwap rejects.
      return [
        { addressType: 'publicAddress', publicAddress: address },
        ...extraAddresses
      ]
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo) {
      checkSpend(spendInfo)
      const balance = balanceMap.get(spendInfo.tokenId) ?? '0'
      // Matches the Ethereum engine: the native branch holds back the fee.
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
  /**
   * What `/estimate` puts in `estimated_amount`. Defaults to echoing a plain
   * amount. A string that is not a number, or a boolean, is how WizardSwap
   * reports failure.
   */
  estimatedAmount?: string | number | boolean
  /** Extra fields merged onto every successful order body. */
  orderExtra?: Record<string, unknown>
  /** Records `<endpoint> <json body>` for every request the plugin sends. */
  requestLog?: string[]
}

/**
 * A two-endpoint provider: `estimate` prices, `exchange` commits. The estimate
 * creates nothing, which is what lets a test assert that the max probe left no
 * live order behind rather than merely counting calls.
 *
 * Every body is prefixed with a literal TAB, exactly as the live API answers.
 */
const makeFakeIo = (opts: FakeIoOpts = {}): { fetch: Function } => {
  const { estimatedAmount, orderExtra = {}, requestLog = [] } = opts
  let lastAmountFrom = '0.5'

  return {
    fetch: async (uri: string, fetchOpts: { body: string }) => {
      const endpoint = uri.split('/').pop() ?? ''
      const sent = JSON.parse(fetchOpts.body)
      requestLog.push(`${endpoint} ${fetchOpts.body}`)

      let body: Record<string, unknown>
      if (endpoint === 'exchange') {
        body = {
          id: 'order-1',
          address_from: DEPOSIT_ADDRESS,
          amount_from: sent.amount_from ?? lastAmountFrom,
          // `amount_to` is the PAYOUT. `expected_amount` echoes the DEPOSIT,
          // exactly as the live API answers, so a plugin that reads the wrong
          // one fails here instead of in production.
          amount_to: '1.25',
          expected_amount: sent.amount_from ?? lastAmountFrom,
          status: 'waiting',
          ...orderExtra
        }
      } else {
        lastAmountFrom = sent.amount_from
        body = {
          estimated_amount: estimatedAmount ?? '1.25'
        }
      }

      return {
        ok: true,
        status: 200,
        // The live API prefixes every response with a tab before the JSON.
        text: async () => `\t${JSON.stringify(body)}`
      }
    }
  }
}

/** Count how many times the plugin hit a given endpoint. */
const countCalls = (requestLog: string[], endpoint: string): number =>
  requestLog.filter(entry => entry.startsWith(`${endpoint} `)).length

const makePlugin = (opts: FakeIoOpts = {}): EdgeSwapPlugin =>
  makeWizardSwapPlugin(({
    io: makeFakeIo(opts),
    initOptions: {},
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
    balanceMap,
    spendLog
  })

const makeXmrWallet = (spendLog?: EdgeSpendInfo[]): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'monero',
    currencyCode: 'XMR',
    address: XMR_ADDRESS,
    multiplier: XMR_MULTIPLIER,
    spendLog
  })

/**
 * Edge's Zcash engine answers `getAddresses` with the unified address FIRST,
 * which is what a plugin gets when it does not ask for a type.
 */
const makeZecWallet = (): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'zcash',
    currencyCode: 'ZEC',
    address: ZEC_UNIFIED_ADDRESS,
    multiplier: ZEC_MULTIPLIER,
    extraAddresses: [
      {
        addressType: 'transparentAddress',
        publicAddress: ZEC_TRANSPARENT_ADDRESS
      }
    ]
  })

const ethToXmr = (
  overrides: Partial<EdgeSwapRequest> = {}
): EdgeSwapRequest => ({
  fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
  fromTokenId: null,
  toWallet: makeXmrWallet(),
  toTokenId: null,
  nativeAmount: HALF_ETH,
  quoteFor: 'from',
  ...overrides
})

describe('wizardswap max quotes', function () {
  it('probes without spending to self, so EVM max swaps work', async function () {
    // Regression shape: a probe whose spendInfo omits `skipChecks` targets the
    // user's own address, and every EVM engine rejects that with
    // `SpendToSelfError`, failing max swaps that normal swaps handle fine.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin()

    const quote = await plugin.fetchSwapQuote(
      ethToXmr({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog),
        nativeAmount: ETH_BALANCE,
        quoteFor: 'max'
      }),
      undefined,
      { infoPayload: {} }
    )

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
    // requests would NOT catch that, since the probe legitimately estimates
    // twice. Assert on the order endpoint specifically.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await plugin.fetchSwapQuote(
      ethToXmr({ nativeAmount: ETH_BALANCE, quoteFor: 'max' }),
      undefined,
      { infoPayload: {} }
    )

    assert.equal(countCalls(requestLog, 'estimate'), 2, 'probe + real quote')
    assert.equal(
      countCalls(requestLog, 'exchange'),
      1,
      'the probe must create nothing; only the real pass orders'
    )
  })

  it('creates no order at all when the probe itself fails', async function () {
    // If the probe path could order, a pair the provider refuses would still
    // leave a live order behind.
    const requestLog: string[] = []
    const plugin = makePlugin({
      requestLog,
      estimatedAmount: 'Insufficient liquidity.'
    })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          ethToXmr({ nativeAmount: ETH_BALANCE, quoteFor: 'max' }),
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )

    assert.equal(countCalls(requestLog, 'exchange'), 0)
  })
})

describe('wizardswap estimate failures', function () {
  it('maps the below-minimum sentence to a limit error', async function () {
    // WizardSwap publishes no limits endpoint, so the minimum is never
    // available to report. The error still has to be the LIMIT one: mapping it
    // to a currency error would tell the user the pair is unsupported when
    // raising the amount would have worked.
    const plugin = makePlugin({ estimatedAmount: 'Value too low.' })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} }),
      'SwapBelowLimitError'
    )
  })

  it('maps a bare false to the same below-minimum error', async function () {
    // Regression shape: the SAME condition is reported two ways by the same
    // endpoint, and `false` is the encoding a string-only cleaner drops.
    const plugin = makePlugin({ estimatedAmount: false })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} }),
      'SwapBelowLimitError'
    )
  })

  it('maps the liquidity sentence to a currency error, not an above-limit', async function () {
    // Regression shape: "Insufficient liquidity." is WizardSwap's catch-all. It
    // is returned for an unroutable pair, for an oversized amount, AND when the
    // caller's IP is throttled, and it carries NO maximum. Reading it as
    // `SwapAboveLimitError` would need a figure that does not exist, and would
    // tell users their amount is too high on pairs WizardSwap simply does not
    // offer.
    const plugin = makePlugin({ estimatedAmount: 'Insufficient liquidity.' })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} }),
      'SwapCurrencyError'
    )
  })

  it('does not treat unrecognized prose as an amount', async function () {
    // Regression shape: the failure and the success share one field, so prose
    // that is not on the known list must NOT flow onward as a quantity. A new
    // sentence from the provider has to surface as an error, never as a swap
    // priced at NaN.
    const plugin = makePlugin({ estimatedAmount: 'Service unavailable.' })

    const error = await captureRejection(
      async () =>
        await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} })
    )

    assert.include(error.message, 'Service unavailable.')
  })

  it('accepts a numeric estimate sent as a JSON number', async function () {
    // The field is a string in practice, but it is untyped on the wire.
    const plugin = makePlugin({ estimatedAmount: 1.25 })

    const quote = await plugin.fetchSwapQuote(ethToXmr(), undefined, {
      infoPayload: {}
    })

    assert.equal(quote.fromNativeAmount, HALF_ETH)
  })

  it('accepts a JSON number small enough to stringify as an exponent', async function () {
    // `String(1e-7)` is '1e-7', which is not a plain decimal. It must still
    // price as an amount, not surface as an unknown provider error.
    const plugin = makePlugin({ estimatedAmount: 1e-7 })

    const quote = await plugin.fetchSwapQuote(ethToXmr(), undefined, {
      infoPayload: {}
    })

    assert.equal(quote.fromNativeAmount, HALF_ETH)
  })
})

describe('wizardswap trust boundary', function () {
  it('rejects a source amount above the requested amount', async function () {
    // Regression shape: the provider's amount becomes a SIGNED SPEND, so an
    // inflated response can move more of the source asset than was quoted.
    const plugin = makePlugin({ orderExtra: { amount_from: '0.9' } })

    const error = await captureRejection(
      async () =>
        await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} })
    )

    assert.include(error.message, 'above the requested amount')
  })

  it('builds the order URI from the plugin constant', async function () {
    // Regression shape: a partner-supplied status URL persisted into `orderUri`
    // renders as a tappable link, so a compromised upstream could steer users
    // anywhere.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({
      orderExtra: { status_url: 'https://evil.example/steal' }
    })

    await plugin.fetchSwapQuote(
      ethToXmr({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog)
      }),
      undefined,
      { infoPayload: {} }
    )

    const { savedAction } = spendLog[0]
    if (savedAction?.actionType !== 'swap') throw new Error('expected a swap')
    assert.equal(savedAction.orderUri, 'https://www.wizardswap.io/?id=order-1')
  })

  it('rounds the receive amount DOWN to whole native units', async function () {
    // Regression shape: `denominationToNative` is a plain multiply, so a payout
    // carrying more decimals than the asset yields a FRACTIONAL native string.
    // Rounding a receive amount UP would show a figure larger than the provider
    // will actually send.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({
      // 12-decimal XMR: this is 1.5 atomic units.
      orderExtra: { amount_to: '0.0000000000015' }
    })

    await plugin.fetchSwapQuote(
      ethToXmr({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog)
      }),
      undefined,
      { infoPayload: {} }
    )

    const { savedAction } = spendLog[0]
    if (savedAction?.actionType !== 'swap') throw new Error('expected a swap')
    assert.equal(savedAction.toAsset.nativeAmount, '1')
  })
})

describe('wizardswap addresses', function () {
  it('pays Zcash out to a transparent address', async function () {
    // WizardSwap validates zec payouts against `^(t)[A-Za-z0-9]{34}$`, so it
    // rejects the unified address Edge's Zcash engine hands back by default.
    // Regression shape: the order is accepted at quote time and the payout
    // fails later, after the deposit has already left the user's wallet.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await plugin.fetchSwapQuote(
      ethToXmr({ toWallet: makeZecWallet() }),
      undefined,
      { infoPayload: {} }
    )

    const orderCall = requestLog.find(entry => entry.startsWith('exchange '))
    if (orderCall == null) throw new Error('expected an order call')
    const sent = JSON.parse(orderCall.slice('exchange '.length))
    assert.equal(sent.address_to, ZEC_TRANSPARENT_ADDRESS)
    assert.equal(sent.currency_to, 'zec')
  })

  it('sends a refund address on every order', async function () {
    // WizardSwap refunds a failed swap to this address. Omitting it leaves a
    // failed order with nowhere to return the deposit.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} })

    const orderCall = requestLog.find(entry => entry.startsWith('exchange '))
    if (orderCall == null) throw new Error('expected an order call')
    const sent = JSON.parse(orderCall.slice('exchange '.length))
    assert.equal(sent.refund_address, ETH_ADDRESS)
  })
})

describe('wizardswap cleaners', function () {
  it('keeps a numeric deposit memo', async function () {
    // Regression shape: `asOptional(asString)` drops a NUMERIC memo and the
    // deposit then goes out untagged. Every asset WizardSwap lists today
    // reports `has_extra_id: false`, so this guards the day one does not.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({ orderExtra: { extra_id_from: 1234567890 } })

    await plugin.fetchSwapQuote(
      ethToXmr({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog)
      }),
      undefined,
      { infoPayload: {} }
    )

    assert.deepEqual(spendLog[0].memos, [{ type: 'text', value: '1234567890' }])
  })

  it('treats a blank deposit memo as absent', async function () {
    // Regression shape: an empty string becomes an empty `EdgeMemo`, which can
    // break fee estimation or broadcast on memo-sensitive chains.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({ orderExtra: { extra_id_from: '' } })

    await plugin.fetchSwapQuote(
      ethToXmr({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog)
      }),
      undefined,
      { infoPayload: {} }
    )

    assert.deepEqual(spendLog[0].memos, [], 'a blank memo must become no memo')
  })

  it('quotes the payout from amount_to, never expected_amount', async function () {
    // Regression shape: `expected_amount` is the DEPOSIT amount, not the
    // receive amount, and the two names read as synonyms. Reading the wrong one
    // quotes every user a receive amount equal to what they are sending.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin({
      orderExtra: { amount_to: '2', expected_amount: '0.1' }
    })

    await plugin.fetchSwapQuote(
      ethToXmr({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog)
      }),
      undefined,
      { infoPayload: {} }
    )

    const { savedAction } = spendLog[0]
    if (savedAction?.actionType !== 'swap') throw new Error('expected a swap')
    assert.equal(savedAction.toAsset.nativeAmount, '2000000000000')
  })

  it('reports a rejected order instead of throwing a cleaner error', async function () {
    // Regression shape: WizardSwap answers HTTP 200 with `status: 'failed'` and
    // null addresses when its address rules refuse the payout address. Cleaning
    // that body surfaces `TypeError: Expected a string, got null at
    // .address_from`, which tells the user nothing and reads as an Edge crash.
    const plugin = makePlugin({
      orderExtra: { status: 'failed', address_from: null, address_to: null }
    })

    const error = await captureRejection(
      async () =>
        await plugin.fetchSwapQuote(
          ethToXmr({
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]))
          }),
          undefined,
          { infoPayload: {} }
        )
    )

    assert.equal(error.name, 'Error')
    assert.match(error.message, /WizardSwap rejected this eth to xmr order/)
  })
})

describe('wizardswap guards', function () {
  it('rejects a same-asset swap before any network call', async function () {
    // Regression shape: skipping `checkInvalidTokenIds` lets a self-swap and
    // every blocked asset reach the partner API.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })
    const wallet = makeEthWallet(new Map([[null, ETH_BALANCE]]))

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          ethToXmr({ fromWallet: wallet, toWallet: wallet }),
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0, 'no request should reach the provider')
  })

  it('rejects a token on either side before any network call', async function () {
    // Regression shape: WizardSwap lists mainnet coins ONLY, and the chain
    // mapping resolves `ethereum` whether or not a token is selected. Without
    // an explicit check a USDC swap quotes as if it were ETH, and the deposit
    // goes to an address expecting ether.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          ethToXmr({
            fromWallet: makeEthWallet(
              new Map([
                [null, ETH_BALANCE],
                [USDC_TOKEN_ID, USDC_BALANCE]
              ])
            ),
            fromTokenId: USDC_TOKEN_ID,
            nativeAmount: USDC_BALANCE
          }),
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0, 'no request should reach the provider')
  })

  it('rejects a reverse quote before any network call', async function () {
    // `/estimate` takes `amount_from` and nothing else, so a request that pins
    // the RECEIVE amount cannot be served. Quoting it as if it were a `from`
    // request would silently swap the wrong amount.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(ethToXmr({ quoteFor: 'to' }), undefined, {
          infoPayload: {}
        }),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0, 'no request should reach the provider')
  })

  it('rejects a chain WizardSwap does not list', async function () {
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await assertRejects(
      async () =>
        await plugin.fetchSwapQuote(
          ethToXmr({
            toWallet: makeFakeWallet({
              pluginId: 'solana',
              currencyCode: 'SOL',
              address: 'So11111111111111111111111111111111111111112',
              multiplier: '1000000000'
            })
          }),
          undefined,
          { infoPayload: {} }
        ),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0, 'no request should reach the provider')
  })

  it('reports the floating rate as an estimate', async function () {
    // Regression shape: hardcoding `isEstimate: false` shows the user a LOCKED
    // receive amount. WizardSwap offers floating rates only.
    const plugin = makePlugin()

    const quote = await plugin.fetchSwapQuote(ethToXmr(), undefined, {
      infoPayload: {}
    })

    assert.equal(quote.isEstimate, true)
  })
})

describe('wizardswap init options', function () {
  it('omits the api key when none is configured', async function () {
    // The key is an affiliate identifier and is optional. Sending `api_key`
    // with an empty or undefined value is not the same as omitting it.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} })

    for (const entry of requestLog) {
      assert.notInclude(entry, 'api_key')
    }
  })

  it('sends the api key on both endpoints when configured', async function () {
    const requestLog: string[] = []
    const plugin = makeWizardSwapPlugin(({
      io: makeFakeIo({ requestLog }),
      initOptions: { apiKey: 'test-key' },
      log: Object.assign(() => {}, { warn() {} })
    } as unknown) as EdgeCorePluginOptions)

    await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} })

    assert.equal(requestLog.length, 2)
    for (const entry of requestLog) {
      assert.include(entry, '"api_key":"test-key"')
    }
  })

  it('keeps the api key out of the logs', async function () {
    // Users export device logs into support tickets, so the request body the
    // plugin prints has to carry a mask where the affiliate key sits.
    const logLog: string[] = []
    const captureLog = (...args: unknown[]): void => {
      logLog.push(args.map(arg => JSON.stringify(arg)).join(' '))
    }
    const plugin = makeWizardSwapPlugin(({
      io: makeFakeIo(),
      initOptions: { apiKey: 'test-key' },
      log: Object.assign(captureLog, { warn: captureLog })
    } as unknown) as EdgeCorePluginOptions)

    await plugin.fetchSwapQuote(ethToXmr(), undefined, { infoPayload: {} })

    assert.isAbove(logLog.length, 0, 'the plugin should log the request body')
    for (const entry of logLog) {
      assert.notInclude(entry, 'test-key')
    }
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
