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

import { makeCypherGoatPlugin } from '../src/swap/central/cyphergoat'

/**
 * CypherGoat is a swap AGGREGATOR reached over two GET endpoints: `/estimate`
 * prices a pair across every underlying exchange and commits to nothing, and
 * `/swap` routes the order to the exchange the estimate picked.
 *
 * The fake API below reproduces the shapes a LIVE CypherGoat returns, including
 * the ones that look like mistakes and are not: capitalized field names from
 * untagged Go structs, amounts as JSON numbers in denominated units, free-text
 * errors, and `{"error":{}}` from `/swap`. Tests written against a tidied-up
 * imagining of this API would pass while the plugin failed in the app.
 */

const ETH_ADDRESS = '0x9A5c4A9F9E6f3fC7f8E1B8B0C9d5e6A7B8C9d0E1'
const XRP_ADDRESS = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'
const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const DEPOSIT_ADDRESS = '0x1111111111111111111111111111111111111111'

/** Real USDC on Ethereum, as `src/mappings/cyphergoat.ts` maps it. */
const USDC_TOKEN_ID = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
/** On the shared `defaultInvalidCodes` list in `swapHelpers.ts`. */
const REP_TOKEN_ID = '1985365e9f78359a9b6ad760e32412f4a445e862'
/**
 * A token CypherGoat does not list, carrying a currencyCode that it DOES list.
 * Any resolution keyed on the currency code rather than the tokenId matches
 * the real USDT here.
 */
const IMPOSTOR_TOKEN_ID = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

const ETH_MULTIPLIER = '1000000000000000000'
const XRP_MULTIPLIER = '1000000'
const BTC_MULTIPLIER = '100000000'
const USDC_MULTIPLIER = '1000000'

const ETH_BALANCE = '1000000000000000000' // 1 ETH
const ETH_FEE = '196600000000000'

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
      currencyInfo,
      allTokens: {
        [USDC_TOKEN_ID]: {
          currencyCode: 'USDC',
          denominations: [{ name: 'USDC', multiplier: USDC_MULTIPLIER }],
          networkLocation: { contractAddress: `0x${USDC_TOKEN_ID}` }
        },
        [IMPOSTOR_TOKEN_ID]: {
          currencyCode: 'USDT',
          denominations: [{ name: 'USDT', multiplier: '1000000' }],
          networkLocation: { contractAddress: `0x${IMPOSTOR_TOKEN_ID}` }
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
  /** Exchange quotes returned in `rates.Results`, best-rate-last by default. */
  results?: Array<{ Exchange: string; Amount: number; KYCScore?: number }>
  /** Top-level `min` on a successful estimate, in denominated units. */
  min?: number
  /** When set, `/estimate` fails with this status and body. */
  estimateFailure?: { status: number; body: string }
  /** When set, `/swap` fails with this status and body. */
  swapFailure?: { status: number; body: string }
  /** Extra fields merged onto the `/swap` transaction object. */
  orderExtra?: Record<string, unknown>
  /** Records `<path> <query>` for every request the plugin sends. */
  requestLog?: string[]
}

/**
 * A two-endpoint CypherGoat: `/estimate` prices, `/swap` commits.
 *
 * Keeping them separate is what lets a test assert the max probe created
 * nothing, rather than merely counting total requests.
 */
const makeFakeIo = (opts: FakeIoOpts = {}): { fetch: Function } => {
  const {
    estimateFailure,
    min = 0.0001,
    orderExtra = {},
    requestLog = [],
    results = [
      { Exchange: 'ChangeNow', Amount: 1.4, KYCScore: 1 },
      // Deliberately not first: the plugin must pick the best payout itself
      // rather than trusting the server's ordering.
      { Exchange: 'FuguSwap', Amount: 1.45, KYCScore: 1 },
      { Exchange: 'Exolix', Amount: 1.43, KYCScore: 0 }
    ]
  } = opts

  return {
    fetch: async (uri: string) => {
      const [path, query = ''] = uri
        .replace('https://api.cyphergoat.com', '')
        .split('?')
      requestLog.push(`${path} ${query}`)

      const fail = path === '/estimate' ? estimateFailure : opts.swapFailure
      if (fail != null) {
        return {
          ok: false,
          status: fail.status,
          json: async () => JSON.parse(fail.body),
          text: async () => fail.body
        }
      }

      const sent = new URLSearchParams(query)
      const body =
        path === '/estimate'
          ? {
              // Capitalized keys and JSON numbers, as the live API returns.
              rates: { Results: results, Min: 0, EstimateId: 1511140 },
              min
            }
          : {
              transaction: {
                Address: DEPOSIT_ADDRESS,
                CGID: 'b9d1c2e3-0000-4000-8000-000000000001',
                Provider: sent.get('partner'),
                SendAmount: Number(sent.get('amount')),
                EstimateAmount: 1.45,
                // The underlying exchange's own tracking URL. The plugin must
                // never persist this as `orderUri`.
                Track: 'https://evil.example.com/steal',
                ...orderExtra
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
const countCalls = (requestLog: string[], path: string): number =>
  requestLog.filter(entry => entry.startsWith(`${path} `)).length

const makePlugin = (opts: FakeIoOpts = {}): EdgeSwapPlugin =>
  makeCypherGoatPlugin(({
    io: makeFakeIo(opts),
    initOptions: { apiKey: 'test-key', affiliateId: 'edge-affiliate' },
    log: Object.assign(() => {}, { warn() {} })
  } as unknown) as EdgeCorePluginOptions)

const makeEthWallet = (
  balanceMap: Map<string | null, string> = new Map(),
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

const makeBtcWallet = (): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'bitcoin',
    currencyCode: 'BTC',
    address: BTC_ADDRESS,
    multiplier: BTC_MULTIPLIER
  })

/** A plain 0.5 ETH -> XRP `from` request. */
const ethToXrp = (overrides: Partial<EdgeSwapRequest> = {}): EdgeSwapRequest =>
  (({
    fromWallet: makeEthWallet(),
    fromTokenId: null,
    toWallet: makeXrpWallet(),
    toTokenId: null,
    nativeAmount: '500000000000000000', // 0.5 ETH
    quoteFor: 'from',
    ...overrides
  } as unknown) as EdgeSwapRequest)

const fetchQuote = async (
  plugin: EdgeSwapPlugin,
  request: EdgeSwapRequest
): ReturnType<EdgeSwapPlugin['fetchSwapQuote']> =>
  await plugin.fetchSwapQuote(request, undefined, { infoPayload: {} })

/**
 * Run a `from` quote and hand back the spend the plugin asked the engine to
 * build. A `from` request never probes, so the log holds exactly one entry: the
 * real spend, carrying the memos and `savedAction` under test.
 */
const quoteSpend = async (
  plugin: EdgeSwapPlugin,
  opts: {
    /** Builds the source wallet, wired to the log this helper reads back. */
    makeFromWallet?: (spendLog: EdgeSpendInfo[]) => EdgeCurrencyWallet
    request?: Partial<EdgeSwapRequest>
  } = {}
): Promise<EdgeSpendInfo> => {
  const {
    makeFromWallet = log => makeEthWallet(new Map(), log),
    request = {}
  } = opts
  const spendLog: EdgeSpendInfo[] = []
  await fetchQuote(
    plugin,
    ethToXrp({ ...request, fromWallet: makeFromWallet(spendLog) })
  )
  return spendLog[spendLog.length - 1]
}

/** The swap action saved on a finished quote's spend. */
const savedSwapAction = (spendInfo: EdgeSpendInfo): any => {
  const { savedAction } = spendInfo
  if (savedAction?.actionType !== 'swap') throw new Error('expected a swap')
  return savedAction
}

describe('cyphergoat max quotes', function () {
  it('probes without spending to self, so EVM max swaps work', async function () {
    // Regression shape: a probe whose spendInfo omits `skipChecks` targets the
    // user's own address, and every EVM engine rejects that with
    // `SpendToSelfError`, failing max swaps that normal swaps handle fine.
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin()

    const quote = await fetchQuote(
      plugin,
      ethToXrp({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]]), spendLog),
        nativeAmount: ETH_BALANCE,
        quoteFor: 'max'
      })
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
    // swap creates and abandons a live order. Counting total requests would NOT
    // catch that, since the probe legitimately estimates twice.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await fetchQuote(
      plugin,
      ethToXrp({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        nativeAmount: ETH_BALANCE,
        quoteFor: 'max'
      })
    )

    assert.equal(
      countCalls(requestLog, '/estimate'),
      2,
      'probe + real estimate'
    )
    assert.equal(
      countCalls(requestLog, '/swap'),
      1,
      'the probe must create nothing; only the real pass orders'
    )
  })

  it('creates no order at all when the probe itself fails', async function () {
    const requestLog: string[] = []
    const plugin = makePlugin({
      requestLog,
      estimateFailure: {
        status: 404,
        body: '{"error":"error getting rates, coin2 not found in namings"}'
      }
    })

    await assertRejects(
      async () =>
        await fetchQuote(
          plugin,
          ethToXrp({
            fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
            nativeAmount: ETH_BALANCE,
            quoteFor: 'max'
          })
        ),
      'SwapCurrencyError'
    )

    assert.equal(countCalls(requestLog, '/swap'), 0)
  })

  it('does not throw an above-limit error on a large balance', async function () {
    // CypherGoat publishes no maximum: a live 100,000 BTC estimate answers 200
    // with ordinary rates. A max swap must therefore always clamp through
    // `getMaxSpendable` rather than abort.
    const plugin = makePlugin()

    const quote = await fetchQuote(
      plugin,
      ethToXrp({
        fromWallet: makeEthWallet(new Map([[null, ETH_BALANCE]])),
        nativeAmount: ETH_BALANCE,
        quoteFor: 'max'
      })
    )

    assert.equal(quote.fromNativeAmount, sub(ETH_BALANCE, ETH_FEE))
  })
})

describe('cyphergoat limits', function () {
  it('enforces the published minimum against the requested amount', async function () {
    // Regression shape: a provider that silently CLAMPS an out-of-range request
    // returns an in-range echo, so comparing the echo lets the swap proceed for
    // less than the user asked.
    const plugin = makePlugin({ min: 0.25 })

    await assertRejects(
      async () =>
        await fetchQuote(
          plugin,
          ethToXrp({ nativeAmount: '10000000000000000' }) // 0.01 ETH
        ),
      'SwapBelowLimitError'
    )
  })

  it('rounds a minimum up to whole native units', async function () {
    // Regression shape: `denominationToNative` is a plain multiply, so a limit
    // with more decimals than the asset yields a fraction. Rounding a floor
    // DOWN would also let an amount under the provider's real minimum through.
    const plugin = makePlugin({ min: 0.0000015 }) // 1.5 drops of XRP-precision

    const error = await captureRejection(
      async () =>
        await fetchQuote(
          plugin,
          ethToXrp({
            fromWallet: makeXrpWallet(),
            toWallet: makeBtcWallet(),
            nativeAmount: '1'
          })
        )
    )

    assert.equal(error.name, 'SwapBelowLimitError')
    // 0.0000015 XRP is 1.5 drops, which must round UP to 2, never down to 1.
    assert.equal((error as any).nativeMin, '2')
  })

  it('reports the minimum from a below-minimum error body', async function () {
    // CypherGoat answers 404 with free text rather than a structured code, and
    // that is the only limit available on this path. It must still surface as
    // SwapBelowLimitError: edge-core-js ranks SwapCurrencyError BELOW another
    // plugin's limit error, so misclassifying hides the figure from the user.
    const plugin = makePlugin({
      estimateFailure: {
        status: 404,
        body:
          '{"error":"amount is less than the minimum value of 0.000044 for btc"}'
      }
    })

    const error = await captureRejection(
      async () =>
        await fetchQuote(
          plugin,
          ethToXrp({ fromWallet: makeBtcWallet(), nativeAmount: '1000' })
        )
    )

    assert.equal(error.name, 'SwapBelowLimitError')
    assert.equal((error as any).nativeMin, '4400') // 0.000044 BTC in satoshis
  })
})

describe('cyphergoat errors', function () {
  it('reports an unquotable mapped pair as a currency error', async function () {
    // A mapped pair CypherGoat could not price is a steady state, not a hard
    // failure: the GUI should omit CypherGoat rather than fail the swap screen.
    const plugin = makePlugin({ results: [] })

    await assertRejects(
      async () => await fetchQuote(plugin, ethToXrp()),
      'SwapCurrencyError'
    )
  })

  it('reports an outage as a real error, not an unsupported pair', async function () {
    // Regression shape: converting a 5xx to SwapCurrencyError reports a
    // permanent "unsupported pair" for a transient outage, and can poison
    // pair-capability caching.
    const plugin = makePlugin({
      estimateFailure: { status: 503, body: 'upstream unavailable' }
    })

    const error = await captureRejection(
      async () => await fetchQuote(plugin, ethToXrp())
    )
    assert.notEqual(error.name, 'SwapCurrencyError')
    assert.include(error.message, '503')
  })

  it('rejects a reverse quote as a currency error', async function () {
    // `/estimate` prices only from a source amount, so a `to` quote is a pair
    // this plugin cannot serve.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await assertRejects(
      async () => await fetchQuote(plugin, ethToXrp({ quoteFor: 'to' })),
      'SwapCurrencyError'
    )
    assert.equal(
      requestLog.length,
      0,
      'a reverse quote must not hit the network'
    )
  })

  it('rejects an unlisted asset before any network call', async function () {
    // Polygon is mapped, but CypherGoat lists no native POL, only tokens.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })
    const polygonWallet = makeFakeWallet({
      pluginId: 'polygon',
      currencyCode: 'POL',
      address: ETH_ADDRESS,
      multiplier: ETH_MULTIPLIER,
      evmChainId: 137
    })

    await assertRejects(
      async () =>
        await fetchQuote(plugin, ethToXrp({ fromWallet: polygonWallet })),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0)
  })

  it('does not resolve an impostor token by its currency code', async function () {
    // The safety property behind keying `cyphergoatAssets` on tokenId: a
    // user-added token whose currencyCode is USDT must NOT be quoted as the
    // real USDT, or the user deposits the impostor against a real USDT order.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await assertRejects(
      async () =>
        await fetchQuote(
          plugin,
          ethToXrp({ fromTokenId: IMPOSTOR_TOKEN_ID, nativeAmount: '1000000' })
        ),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0)
  })

  it('rejects a same-asset swap client-side', async function () {
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await assertRejects(
      async () =>
        await fetchQuote(
          plugin,
          ethToXrp({ toWallet: makeEthWallet(), toTokenId: null })
        ),
      'SwapCurrencyError'
    )
    assert.equal(requestLog.length, 0)
  })
})

describe('cyphergoat orders', function () {
  it('routes the order to the best-paying exchange', async function () {
    // The plugin re-derives the winner rather than trusting `Results` ordering,
    // and compares with biggystring rather than floats.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await fetchQuote(plugin, ethToXrp())

    const swapCall = requestLog.find(entry => entry.startsWith('/swap '))
    assert.isDefined(swapCall)
    assert.include(swapCall as string, 'partner=FuguSwap')
  })

  it('sends the mapped coin/network pair and the affiliate code', async function () {
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await fetchQuote(plugin, ethToXrp())

    const estimateCall = requestLog.find(entry =>
      entry.startsWith('/estimate ')
    )
    assert.include(estimateCall as string, 'coin1=eth')
    assert.include(estimateCall as string, 'network1=eth')
    assert.include(estimateCall as string, 'coin2=xrp')
    assert.include(estimateCall as string, 'network2=xrp')

    const swapCall = requestLog.find(entry => entry.startsWith('/swap '))
    assert.include(swapCall as string, 'affiliate=edge-affiliate')
    assert.include(swapCall as string, 'source=edge')
    assert.include(swapCall as string, 'estimateid=1511140')
  })

  it('maps a token to its CypherGoat coin/network pair', async function () {
    // USDC on Ethereum is `usdc`/`usdc` to CypherGoat, not `usdc`/`eth`: its
    // `network` field is an asset-family name, not a chain.
    const requestLog: string[] = []
    const plugin = makePlugin({ requestLog })

    await fetchQuote(
      plugin,
      ethToXrp({ fromTokenId: USDC_TOKEN_ID, nativeAmount: '14009000' })
    )

    const estimateCall = requestLog.find(entry =>
      entry.startsWith('/estimate ')
    )
    assert.include(estimateCall as string, 'coin1=usdc')
    assert.include(estimateCall as string, 'network1=usdc')
    assert.include(estimateCall as string, 'amount=14.009')
  })

  it('builds the order URI from a plugin constant, not the provider URL', async function () {
    // Regression shape: `orderUri` renders as a tappable link, so accepting the
    // provider's `Track` host and scheme lets a compromised upstream steer
    // users anywhere.
    const plugin = makePlugin()

    const action = savedSwapAction(await quoteSpend(plugin))

    assert.equal(
      action.orderUri,
      'https://cyphergoat.com/transaction/b9d1c2e3-0000-4000-8000-000000000001'
    )
    assert.notInclude(action.orderUri, 'evil.example.com')
  })

  it('reports the rate as an estimate', async function () {
    // CypherGoat quotes floating rates only. Hardcoding `false` would show the
    // user a locked receive amount on a route that can deliver less.
    const plugin = makePlugin()

    assert.equal(savedSwapAction(await quoteSpend(plugin)).isEstimate, true)
  })

  it('keeps a numeric memo, including the valid tag 0', async function () {
    // Regression shape: a string-only memo cleaner drops a NUMERIC XRP
    // destination tag, sending an untagged deposit and losing the funds.
    const plugin = makePlugin({ orderExtra: { Memo: 0 } })

    const spendInfo = await quoteSpend(plugin, {
      makeFromWallet: spendLog => makeXrpWallet(spendLog),
      request: { toWallet: makeBtcWallet(), nativeAmount: '10000000' }
    })

    const memos = spendInfo.memos ?? []
    assert.equal(memos.length, 1, 'destination tag 0 must survive the cleaner')
    assert.equal(memos[0].value, '0')
  })

  it('sends no memo when the provider returns a blank one', async function () {
    // An empty string must become NO memo, not an empty EdgeMemo.
    const plugin = makePlugin({ orderExtra: { Memo: '' } })

    const spendInfo = await quoteSpend(plugin)
    assert.deepEqual(spendInfo.memos ?? [], [])
  })

  it('rounds the receive amount down to whole native units', async function () {
    // Never show the user more than what actually arrives.
    const plugin = makePlugin({ orderExtra: { EstimateAmount: 1.4567891 } })

    const action = savedSwapAction(await quoteSpend(plugin))
    // 6-decimal XRP: 1.4567891 XRP truncates to 1456789 drops, never 1456790.
    assert.equal(action.toAsset.nativeAmount, '1456789')
  })

  it('spends exactly the requested amount', async function () {
    const plugin = makePlugin()

    const spendInfo = await quoteSpend(plugin)

    assert.equal(spendInfo.spendTargets[0].nativeAmount, '500000000000000000')
    assert.equal(spendInfo.spendTargets[0].publicAddress, DEPOSIT_ADDRESS)
  })

  it('rejects an order asking for more than the user requested', async function () {
    // Trust boundary: the spend is about to be signed, so a response demanding
    // more of the source asset than was quoted must not become a transaction.
    const plugin = makePlugin({ orderExtra: { SendAmount: 5 } }) // vs 0.5 ETH

    const error = await captureRejection(
      async () => await fetchQuote(plugin, ethToXrp())
    )
    assert.include(error.message, 'above the requested amount')
  })

  it('surfaces an empty swap error body as a generic failure', async function () {
    // `/swap` serializes a Go error value, so its body is `{"error":{}}` and
    // carries nothing to classify on. Guessing would report an unsupported pair
    // for a transient order-creation failure.
    const plugin = makePlugin({
      swapFailure: { status: 400, body: '{"error":{}}' }
    })

    const error = await captureRejection(
      async () => await fetchQuote(plugin, ethToXrp())
    )
    assert.notEqual(error.name, 'SwapCurrencyError')
    assert.include(error.message, '400')
  })
})

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
