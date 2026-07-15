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

import { makeSwapterPlugin } from '../src/swap/central/swapter'

const ETH_ADDRESS = '0x9A5c4A9F9E6f3fC7f8E1B8B0C9d5e6A7B8C9d0E1'
const LTC_ADDRESS = 'LZ4hqRRHuCEUZaKfDrpvJ4NCFVBTFVQzcU'
const DEPOSIT_ADDRESS = '0x1111111111111111111111111111111111111111'
const ZEC_UNIFIED_ADDRESS = 'u1qqqqq0unifiedzcashaddress'
const ZEC_TRANSPARENT_ADDRESS = 't1XyZtransparentzcashaddress'

/** What the Ethereum engine holds back for the network fee. */
const ETH_FEE = '196600000000000'

/**
 * The pair's live range in ETH, and the same bounds in native wei. Both bounds
 * carry more decimals than a whole-wei amount, so they exercise the inward
 * rounding the plugin applies: the minimum rounds up and the maximum down.
 */
const RANGE_MIN = '0.0160060'
const RANGE_MAX = '5239.5248798'
const RANGE_MIN_NATIVE = '16006000000000000'
const RANGE_MAX_NATIVE = '5239524879800000000000'

const IN_RANGE_NATIVE = '100000000000000000' // 0.1 ETH
const BELOW_MIN_NATIVE = '15000000000000000' // 0.015 ETH
const ABOVE_MAX_NATIVE = '9999000000000000000000' // 9999 ETH

interface FakeWalletOpts {
  pluginId: string
  currencyCode: string
  address: string
  multiplier: string
  balanceMap?: Map<string | null, string>
  spendLog?: EdgeSpendInfo[]
  /** Overrides the single-address default, in engine order. */
  addresses?: Array<{ addressType: string; publicAddress: string }>
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const {
    address,
    addresses = [{ addressType: 'publicAddress', publicAddress: address }],
    balanceMap = new Map(),
    currencyCode,
    multiplier,
    pluginId,
    spendLog = []
  } = opts

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
      allTokens: {}
    },
    async getAddresses() {
      return addresses
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo) {
      spendLog.push(spendInfo)
      const balance = balanceMap.get(spendInfo.tokenId) ?? '0'
      return spendInfo.tokenId == null ? sub(balance, ETH_FEE) : balance
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      spendLog.push(spendInfo)
      return ({
        networkFee: '0',
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      } as unknown) as EdgeTransaction
    }
  } as unknown) as EdgeCurrencyWallet
}

/** A non-ok body the fake `fetchCors` returns from the create endpoint. */
type CreateError = Record<string, unknown> | null

interface FakeIoLog {
  /** Every URI the plugin requested, in order. */
  uris: string[]
  /** Parsed request bodies sent to the create endpoint. */
  createBodies: Array<Record<string, any>>
}

/**
 * A `/data/coins` row, in Swapter's shape: an asset listed on one network for
 * both directions. The plugin keeps only rows it can both deposit and withdraw
 * on a network this mapping lists.
 */
const coinRow = (
  currency: string,
  network: string
): Record<string, unknown> => ({
  currency,
  networks: {
    deposit: [{ network, contract: null }],
    withdraw: [{ network, contract: null }]
  }
})

/** Enough of a live snapshot to cover the pairs these cases quote. */
const COINS = {
  assets: [coinRow('ETH', 'ETH'), coinRow('LTC', 'LTC'), coinRow('ZEC', 'ZEC')]
}

/**
 * Canned Swapter responses. `emptyCoins` reproduces a provider answering 200
 * with nothing usable, which the plugin must treat as an outage rather than as
 * an unsupported pair.
 */
const makeFakeIo = (
  log: FakeIoLog,
  createError: CreateError = null,
  emptyCoins: boolean = false
): { fetchCors: Function } => ({
  fetchCors: async (uri: string, opts: { body?: string }) => {
    log.uris.push(uri)

    const ok = (body: unknown): unknown => ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body)
    })

    if (uri.endsWith('/data/coins')) {
      return ok(emptyCoins ? { assets: [] } : COINS)
    }

    if (uri.endsWith('/adapter/edge/swap/deposit-range')) {
      return ok({ min: RANGE_MIN, max: RANGE_MAX })
    }

    // Anything else must be the create call, and the assertions below check it
    // reached the adapter route rather than the `/v2` original.
    log.createBodies.push(JSON.parse(opts.body ?? '{}'))

    if (createError != null) {
      return {
        ok: false,
        status: 400,
        json: async () => createError,
        text: async () => JSON.stringify(createError)
      }
    }

    return ok({
      uid: 'order-1',
      deposit: { address: DEPOSIT_ADDRESS, memo: null },
      withdraw: { amount: { expected: '2.045' } }
    })
  }
})

const makePlugin = (
  log: FakeIoLog,
  createError: CreateError = null,
  emptyCoins: boolean = false
): EdgeSwapPlugin =>
  makeSwapterPlugin(({
    io: makeFakeIo(log, createError, emptyCoins),
    initOptions: { apiKey: 'test-key' },
    log: { warn() {} }
  } as unknown) as EdgeCorePluginOptions)

const makeLog = (): FakeIoLog => ({ uris: [], createBodies: [] })

const makeEthWallet = (
  balanceMap?: Map<string | null, string>,
  spendLog?: EdgeSpendInfo[]
): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'ethereum',
    currencyCode: 'ETH',
    address: ETH_ADDRESS,
    multiplier: '1000000000000000000',
    balanceMap,
    spendLog
  })

const makeLtcWallet = (): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'litecoin',
    currencyCode: 'LTC',
    address: LTC_ADDRESS,
    multiplier: '100000000'
  })

/**
 * A Zcash wallet in engine order: the unified address first, which is what a
 * bare `getAddress` would pick.
 */
const makeZecWallet = (): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'zcash',
    currencyCode: 'ZEC',
    address: ZEC_UNIFIED_ADDRESS,
    multiplier: '100000000',
    addresses: [
      { addressType: 'unifiedAddress', publicAddress: ZEC_UNIFIED_ADDRESS },
      {
        addressType: 'transparentAddress',
        publicAddress: ZEC_TRANSPARENT_ADDRESS
      }
    ]
  })

const makeRequest = (
  nativeAmount: string,
  overrides: Partial<EdgeSwapRequest> = {}
): EdgeSwapRequest =>
  (({
    fromWallet: makeEthWallet(),
    fromTokenId: null,
    toWallet: makeLtcWallet(),
    toTokenId: null,
    nativeAmount,
    quoteFor: 'from',
    ...overrides
  } as unknown) as EdgeSwapRequest)

const fetchQuote = async (
  plugin: EdgeSwapPlugin,
  request: EdgeSwapRequest
): Promise<unknown> =>
  await plugin.fetchSwapQuote(request, undefined, { infoPayload: {} })

const expectError = async (
  promise: Promise<unknown>
): Promise<{ name: string; nativeMax?: string; nativeMin?: string }> => {
  try {
    await promise
  } catch (error: unknown) {
    return error as { name: string; nativeMax?: string; nativeMin?: string }
  }
  throw new Error('Expected the quote to throw')
}

describe('swapter', function () {
  it('uses the Edge adapter endpoints, not the /v2 originals', async function () {
    const log = makeLog()
    await fetchQuote(makePlugin(log), makeRequest(IN_RANGE_NATIVE))

    // The adapter routes serialize amounts as strings, where `/v2` returns
    // unquoted JSON numbers that lose precision in `JSON.parse`. The range
    // route is also authoritative: the `/v2/swap/min-amount` floor it replaced
    // is LOWER than the one create enforces, so quoting against that produced
    // orders the provider then rejected.
    assert.isTrue(
      log.uris.some(uri => uri.endsWith('/adapter/edge/swap/deposit-range'))
    )
    assert.isTrue(
      log.uris.some(uri => uri.endsWith('/adapter/edge/swap/create'))
    )
    assert.isFalse(log.uris.some(uri => uri.includes('/v2/swap/')))
  })

  it('rejects an amount below the range minimum', async function () {
    const error = await expectError(
      fetchQuote(makePlugin(makeLog()), makeRequest(BELOW_MIN_NATIVE))
    )

    assert.equal(error.name, 'SwapBelowLimitError')
    assert.equal(error.nativeMin, RANGE_MIN_NATIVE)
  })

  it('rejects an amount above the range maximum', async function () {
    const log = makeLog()
    const error = await expectError(
      fetchQuote(makePlugin(log), makeRequest(ABOVE_MAX_NATIVE))
    )

    assert.equal(error.name, 'SwapAboveLimitError')
    assert.equal(error.nativeMax, RANGE_MAX_NATIVE)
    // The ceiling is known before any order exists, so no create is spent.
    assert.lengthOf(log.createBodies, 0)
  })

  it('clamps a max swap through getMaxSpendable instead of the ceiling', async function () {
    // The probe quotes the whole PRE-fee balance to discover what is spendable.
    // Enforcing the ceiling there would throw on an amount the user never asked
    // to send, so only the real quote enforces it.
    const spendLog: EdgeSpendInfo[] = []
    const balance = '1000000000000000000' // 1 ETH, inside the range
    const request = makeRequest('0', {
      fromWallet: makeEthWallet(new Map([[null, balance]]), spendLog),
      quoteFor: 'max'
    })

    const quote = (await fetchQuote(makePlugin(makeLog()), request)) as {
      fromNativeAmount: string
    }

    assert.equal(quote.fromNativeAmount, sub(balance, ETH_FEE))
    // The fee-estimation probe targets the user's own address, so it must opt
    // out of the engine's spend checks; the real order must not.
    const [probeSpend] = spendLog
    assert.equal(probeSpend.skipChecks, true)
    assert.equal(probeSpend.spendTargets[0].publicAddress, ETH_ADDRESS)
  })

  it('maps the create above-maximum code to an above-limit error', async function () {
    // The range moves with the rate, so an amount that cleared the range check
    // can still be rejected by `create`. Swapter now distinguishes the two
    // bounds by code, where both used to share `factory:6`.
    const log = makeLog()
    const error = await expectError(
      fetchQuote(
        makePlugin(log, {
          error: {
            code: 'io.swapter.controller.swap.factory:9',
            message:
              'Requested deposit amount is greater than allowed maximum.',
            max: RANGE_MAX
          }
        }),
        makeRequest(IN_RANGE_NATIVE)
      )
    )

    assert.equal(error.name, 'SwapAboveLimitError')
    assert.equal(error.nativeMax, RANGE_MAX_NATIVE)
    // A limit applies to both swap types, so the fixed-rate rejection must not
    // spend a second create on the floating fallback.
    assert.lengthOf(log.createBodies, 1)
  })

  // create namespaces its unsupported-pair codes, where the deposit range
  // answers a bare service code, so both vocabularies have to be recognised.
  const UNSUPPORTED_PAIR_CASES = [
    [
      'io.swapter.controller.swap.factory:1',
      'Networks for specified coin does not exist.'
    ],
    [
      'io.swapter.controller.swap.factory:2',
      'Specified deposit network does not exist.'
    ],
    [
      'io.swapter.controller.swap.factory:3',
      'Specified withdraw network does not exist.'
    ],
    ['1', 'Deposit coin and network combination does not exists.']
  ]

  for (const [code, message] of UNSUPPORTED_PAIR_CASES) {
    it(`treats create code ${code} as an unsupported pair, with no float retry`, async function () {
      const log = makeLog()
      const error = await expectError(
        fetchQuote(
          makePlugin(log, { error: { code, message } }),
          makeRequest(IN_RANGE_NATIVE)
        )
      )

      assert.equal(error.name, 'SwapCurrencyError')
      assert.lengthOf(log.createBodies, 1)
    })
  }

  it('fails the quote when the ticker map is empty, instead of reporting an unsupported pair', async function () {
    // A 200 carrying no usable assets is a provider outage. Mainnet codes come
    // from the wallets' own `currencyInfo`, so without this guard the quote
    // would proceed and only token pairs would fail, as `SwapCurrencyError`.
    const log = makeLog()
    const error = await expectError(
      fetchQuote(makePlugin(log, null, true), makeRequest(IN_RANGE_NATIVE))
    )

    assert.notEqual(error.name, 'SwapCurrencyError')
    assert.lengthOf(log.createBodies, 0)
  })

  it('sends the transparent address for Zcash, not the unified default', async function () {
    // The engine lists the unified address first, and a CEX that cannot pay or
    // refund one strands the deposit.
    const log = makeLog()
    await fetchQuote(
      makePlugin(log),
      makeRequest(IN_RANGE_NATIVE, {
        fromWallet: makeEthWallet(),
        toWallet: makeZecWallet()
      })
    )

    const [createBody] = log.createBodies
    assert.equal(createBody.withdraw.address, ZEC_TRANSPARENT_ADDRESS)
  })

  it('maps a bound-less limit code, so the fallback does not retry it', async function () {
    // Swapter does not always echo the bound it rejected against. Requiring one
    // dropped the rejection to a generic error, which is not pair-level, so the
    // float fallback spent a second create on the same doomed amount.
    const log = makeLog()
    const error = await expectError(
      fetchQuote(
        makePlugin(log, {
          error: {
            code: 'io.swapter.controller.swap.factory:6',
            message: 'Requested deposit amount is lower than allowed minimum.'
          }
        }),
        makeRequest(IN_RANGE_NATIVE)
      )
    )

    assert.equal(error.name, 'SwapBelowLimitError')
    assert.equal(error.nativeMin, '')
    assert.lengthOf(log.createBodies, 1)
  })

  it('maps the create below-minimum code to a below-limit error', async function () {
    const log = makeLog()
    const error = await expectError(
      fetchQuote(
        makePlugin(log, {
          error: {
            code: 'io.swapter.controller.swap.factory:6',
            message: 'Requested deposit amount is lower than allowed minimum.',
            min: RANGE_MIN
          }
        }),
        makeRequest(IN_RANGE_NATIVE)
      )
    )

    assert.equal(error.name, 'SwapBelowLimitError')
    assert.equal(error.nativeMin, RANGE_MIN_NATIVE)
    assert.lengthOf(log.createBodies, 1)
  })
})
