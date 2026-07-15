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
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const {
    address,
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
      return [{ addressType: 'publicAddress', publicAddress: address }]
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

/** A non-ok body the fake `fetchCors` returns from `/v2/swap/create`. */
type CreateError = Record<string, unknown> | null

interface FakeIoLog {
  /** Every URI the plugin requested, in order. */
  uris: string[]
  /** Parsed request bodies sent to `/v2/swap/create`. */
  createBodies: Array<Record<string, any>>
}

/**
 * Canned Swapter responses. `/data/coins` is empty, which is enough for a
 * mainnet pair: `getChainAndTokenCodes` derives those codes from the wallets'
 * own `currencyInfo`, and the ticker map only carries tokens.
 */
const makeFakeIo = (
  log: FakeIoLog,
  createError: CreateError = null
): { fetchCors: Function } => ({
  fetchCors: async (uri: string, opts: { body?: string }) => {
    log.uris.push(uri)

    const ok = (body: unknown): unknown => ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body)
    })

    if (uri.endsWith('/data/coins')) return ok({ assets: [] })

    if (uri.endsWith('/adapter/edge/swap/deposit-range')) {
      return ok({ min: RANGE_MIN, max: RANGE_MAX })
    }

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
  createError: CreateError = null
): EdgeSwapPlugin =>
  makeSwapterPlugin(({
    io: makeFakeIo(log, createError),
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
  it('reads the deposit range from the Edge adapter endpoint', async function () {
    const log = makeLog()
    await fetchQuote(makePlugin(log), makeRequest(IN_RANGE_NATIVE))

    // The `/v2/swap/min-amount` floor this replaced is LOWER than the floor
    // `create` enforces, so quoting against it produced orders the provider
    // then rejected. The adapter route is authoritative and returns strings.
    assert.isTrue(
      log.uris.some(uri => uri.endsWith('/adapter/edge/swap/deposit-range'))
    )
    assert.isFalse(log.uris.some(uri => uri.endsWith('/v2/swap/min-amount')))
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

  it('does not retry an unsupported-pair create as a floating order', async function () {
    const log = makeLog()
    const error = await expectError(
      fetchQuote(
        makePlugin(log, {
          error: {
            code: '1',
            message: 'Deposit coin and network combination does not exists.'
          }
        }),
        makeRequest(IN_RANGE_NATIVE)
      )
    )

    assert.equal(error.name, 'SwapCurrencyError')
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
