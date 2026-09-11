/**
 * Acceptance tests for the HoudiniSwap plugin.
 *
 * Runs the real `makeHoudiniPlugin` quote -> create-exchange flow. Every
 * Houdini API response is cached to disk (`test/houdiniFixtures/`) on first
 * fetch and replayed afterwards, so repeat runs make zero live calls and stay
 * inside the partner API budget (5/min, 20/hr, 50/day quotes; 1/min, 5/hr,
 * 10/day exchanges). On a live first run, a single backoff retry handles the
 * 1-per-minute exchange limit.
 *
 * Live re-recording needs credentials in `testconfig.json` -> `HOUDINI_INIT`,
 * the same way other partners are wired; cached replays run with placeholder
 * credentials (the fixture key ignores headers). The on-device pieces a swap
 * quote does not depend on (address derivation, `makeSpend`) are stubbed; the
 * tests exercise token resolution, quoting (both directions), order creation
 * (including a destination tag), and `SwapOrder` construction.
 */
import { expect } from 'chai'
import { makeConfig } from 'cleaner-config'
import { createHash } from 'crypto'
import {
  EdgeCurrencyWallet,
  EdgeMemo,
  EdgeSwapQuote,
  EdgeSwapRequest
} from 'edge-core-js/types'
import fs from 'fs'
import { describe, it } from 'mocha'
import path from 'path'

import {
  makeHoudiniPlugin,
  quoteValidUntilMs,
  rateLimitDelayMs
} from '../src/swap/central/houdini'
import { asTestConfig } from './testconfig'

const config = makeConfig(asTestConfig, './testconfig.json')

const FIXTURE_DIR = path.join(__dirname, 'houdiniFixtures')

interface CachedResponse {
  status: number
  ok: boolean
  body: string
}

interface FetchResponseLike {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

const sleep = async (ms: number): Promise<void> =>
  await new Promise(resolve => setTimeout(resolve, ms))

const fixturePath = (method: string, url: string, body: string): string => {
  const hash = createHash('sha256')
    .update(`${method} ${url} ${body}`)
    .digest('hex')
    .slice(0, 24)
  return path.join(FIXTURE_DIR, `${hash}.json`)
}

const toResponse = (cached: CachedResponse): FetchResponseLike => ({
  ok: cached.ok,
  status: cached.status,
  json: async () => JSON.parse(cached.body),
  text: async () => cached.body
})

/** The last create-exchange request body, for asserting what went out. */
let lastExchangeBody: string | undefined

/**
 * Disk-caching fetch. Replays a saved fixture when present; otherwise hits the
 * live API, persists the response, and retries once on a rate-limit response
 * after the server-reported backoff.
 */
const cachingFetch = async (
  url: string,
  opts: {
    method?: string
    headers?: { [key: string]: string }
    body?: string
  } = {}
): Promise<FetchResponseLike> => {
  const method = opts.method ?? 'GET'
  const body = opts.body ?? ''
  if (method === 'POST' && url.endsWith('/exchanges')) {
    lastExchangeBody = body
  }
  const file = fixturePath(method, url, body)

  if (fs.existsSync(file)) {
    const cached: CachedResponse = JSON.parse(fs.readFileSync(file, 'utf8'))
    return toResponse(cached)
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const live = await fetch(url, {
      method,
      headers: opts.headers,
      body: opts.body
    })
    const text = await live.text()

    if (live.status === 429 || text.includes('RATE_LIMIT_EXCEEDED')) {
      let retryAfter = 15
      try {
        retryAfter = JSON.parse(text).retryAfter ?? 15
      } catch (error: unknown) {}
      if (attempt === 0) {
        await sleep((retryAfter + 2) * 1000)
        continue
      }
    }

    const cached: CachedResponse = {
      status: live.status,
      ok: live.ok,
      body: text
    }
    fs.mkdirSync(FIXTURE_DIR, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(cached, null, 2))
    return toResponse(cached)
  }
  throw new Error('Unreachable')
}

const fakeLog = Object.assign(() => {}, {
  warn: () => {},
  error: () => {},
  crash: async () => {},
  breadcrumb: () => {}
})

interface FakeToken {
  currencyCode: string
  denominations: Array<{ name: string; multiplier: string }>
  networkLocation: { contractAddress: string }
}

// Records the last spend the plugin built, so the tests can prove the order's
// deposit address and swap action landed on the transaction.
interface SpendCapture {
  depositAddress?: string
  nativeAmount?: string
  memos?: EdgeMemo[]
  savedAction?: unknown
  /** The spendInfo `getMaxSwappable` priced, so the probe can be asserted. */
  maxSpendInfo?: { skipChecks?: boolean }
}

const makeFakeWallet = (
  params: {
    pluginId: string
    currencyCode: string
    decimals: number
    address: string
    tokens?: { [tokenId: string]: FakeToken }
    /** Native balance, for the `max` path that sizes a quote off it. */
    balance?: string
    /**
     * What `getMaxSpendable` reports, when it differs from the balance. A real
     * engine subtracts the network fee here, which is what lets a max swap off
     * an above-limit balance land inside the route's range.
     */
    maxSpendable?: string
    /** Set on an EVM chain, which is what makes a dex route executable. */
    evmChainId?: number
  },
  capture: SpendCapture
): EdgeCurrencyWallet => {
  const {
    pluginId,
    currencyCode,
    decimals,
    address,
    tokens = {},
    balance = '0',
    maxSpendable = balance,
    evmChainId
  } = params
  const multiplier = `1${'0'.repeat(decimals)}`
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }],
    evmChainId
  }
  const wallet = {
    id: `${pluginId}-wallet`,
    currencyInfo,
    currencyConfig: { currencyInfo, allTokens: tokens },
    balanceMap: new Map([[null, balance]]),
    // The whole balance is spendable; these tests care about how many calls
    // the max path makes, not about fee arithmetic. The spend-to-self guard
    // mirrors an EVM engine, where the public key IS the address: without
    // `skipChecks` on the probe, that engine rejects the max-sizing spend and
    // the error escapes `getMaxSwappable`.
    getMaxSpendable: async (spendInfo: {
      skipChecks?: boolean
      spendTargets: Array<{ publicAddress: string }>
    }) => {
      capture.maxSpendInfo = spendInfo
      const { skipChecks = false } = spendInfo
      for (const spendTarget of spendInfo.spendTargets) {
        if (!skipChecks && spendTarget.publicAddress === address) {
          throw new Error('SpendToSelfError')
        }
      }
      return maxSpendable
    },
    getAddresses: async () => [
      { publicAddress: address, addressType: 'publicAddress' },
      { publicAddress: address, addressType: 'transparentAddress' }
    ],
    makeSpend: async (spendInfo: {
      tokenId: string | null
      spendTargets: Array<{ nativeAmount: string; publicAddress: string }>
      memos?: EdgeMemo[]
      savedAction: unknown
    }) => {
      capture.depositAddress = spendInfo.spendTargets[0].publicAddress
      capture.nativeAmount = spendInfo.spendTargets[0].nativeAmount
      capture.memos = spendInfo.memos
      capture.savedAction = spendInfo.savedAction
      return {
        savedAction: spendInfo.savedAction,
        nativeAmount: `-${spendInfo.spendTargets[0].nativeAmount}`,
        networkFee: '0',
        tokenId: spendInfo.tokenId,
        currencyCode,
        metadata: {}
      }
    },
    // Enough of the signing surface for `approve` to run to its end:
    signTx: async (tx: object) => tx,
    broadcastTx: async (tx: object) => ({ ...tx, txid: '0xtxhash' }),
    saveTx: async () => {}
  }
  // The tests only need the wallet surface the plugin and swap helpers touch.
  return (wallet as unknown) as EdgeCurrencyWallet
}

/**
 * Mirrors the core-built synthetic destination wallet of a swap-to-address
 * request: one pasted address (`publicAddress` type only), a `synthetic://`
 * id, no spend methods, and destination memos exposed through `getMemos`.
 */
const makeFakeSyntheticDestination = (params: {
  pluginId: string
  currencyCode: string
  decimals: number
  toAddress: string
  toMemos?: EdgeMemo[]
}): EdgeCurrencyWallet => {
  const { pluginId, currencyCode, decimals, toAddress, toMemos = [] } = params
  const multiplier = `1${'0'.repeat(decimals)}`
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  }
  const wallet = {
    id: `synthetic://${pluginId}`,
    currencyInfo,
    currencyConfig: { currencyInfo, allTokens: {} },
    getAddresses: async () => [
      { publicAddress: toAddress, addressType: 'publicAddress' }
    ],
    getMemos: async () => toMemos
  }
  return (wallet as unknown) as EdgeCurrencyWallet
}

/** 1300 S, the send amount the sim drive used. */
const SONIC_NATIVE_AMOUNT = '1300000000000000000000'

describe('houdini', function () {
  // Live re-recording waits out the 1/min exchange budget:
  this.timeout(120000)

  // Live calls need real credentials from `testconfig.json` -> `HOUDINI_INIT`.
  // Cache hits do not (the fixture key ignores headers), so committed fixtures
  // replay anywhere with placeholder credentials.
  const initOptions =
    config.HOUDINI_INIT === false
      ? { apiKey: 'CACHE_REPLAY', apiSecret: 'CACHE_REPLAY' }
      : config.HOUDINI_INIT

  // Minimal plugin options: only `initOptions`, `io.fetch`/`io.fetchCors`, and
  // `log` are touched by the plugin.
  const pluginOpts = ({
    initOptions,
    io: { fetch: cachingFetch, fetchCors: cachingFetch },
    log: fakeLog
  } as unknown) as Parameters<typeof makeHoudiniPlugin>[0]
  const plugin = makeHoudiniPlugin(pluginOpts)

  const usdcContract = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const usdcTokenId = usdcContract.slice(2)

  const capture: SpendCapture = {}

  const btcWallet = makeFakeWallet(
    {
      pluginId: 'bitcoin',
      currencyCode: 'BTC',
      decimals: 8,
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
    },
    capture
  )
  const ethWallet = makeFakeWallet(
    {
      pluginId: 'ethereum',
      currencyCode: 'ETH',
      decimals: 18,
      address: '0x9f1f9a5c0f1d9a5c0f1d9a5c0f1d9a5c0f1d9a5c',
      tokens: {
        [usdcTokenId]: {
          currencyCode: 'USDC',
          denominations: [{ name: 'USDC', multiplier: '1000000' }],
          networkLocation: { contractAddress: usdcContract }
        }
      }
    },
    capture
  )

  const fetchQuote = async (
    request: EdgeSwapRequest
  ): Promise<EdgeSwapQuote> => {
    capture.depositAddress = undefined
    lastExchangeBody = undefined
    return await plugin.fetchSwapQuote(request, undefined, { infoPayload: {} })
  }

  it('quotes and orders a forward BTC -> ETH private swap', async function () {
    const quote = await fetchQuote({
      fromWallet: btcWallet,
      toWallet: ethWallet,
      fromTokenId: null,
      toTokenId: null,
      nativeAmount: '5000000', // 0.05 BTC
      quoteFor: 'from'
    })

    expect(quote.fromNativeAmount).is.a('string').and.not.equals('0')
    expect(quote.toNativeAmount).is.a('string').and.not.equals('0')
    expect(capture.depositAddress).is.a('string')
    expect(quote.pluginId).equals('houdini')
  })

  it('quotes and orders a forward ETH -> USDC private swap', async function () {
    const quote = await fetchQuote({
      fromWallet: ethWallet,
      toWallet: ethWallet,
      fromTokenId: null,
      toTokenId: usdcTokenId,
      nativeAmount: '300000000000000000', // 0.3 ETH
      quoteFor: 'from'
    })

    expect(quote.fromNativeAmount).equals('300000000000000000')
    expect(quote.toNativeAmount).is.a('string').and.not.equals('0')
    expect(capture.depositAddress).is.a('string')
  })

  it('quotes a reverse BTC -> ETH swap by the receive amount', async function () {
    const quote = await fetchQuote({
      fromWallet: btcWallet,
      toWallet: ethWallet,
      fromTokenId: null,
      toTokenId: null,
      nativeAmount: '150000000000000000', // 0.15 ETH, the amount the recipient gets
      quoteFor: 'to'
    })

    // The provider prices the send side for the fixed receive amount:
    expect(quote.fromNativeAmount).is.a('string').and.not.equals('0')
    expect(quote.toNativeAmount).is.a('string').and.not.equals('0')
    expect(capture.depositAddress).is.a('string')
  })

  it('passes a destination tag through to order creation for a synthetic memo-chain destination', async function () {
    const xrpDestination = makeFakeSyntheticDestination({
      pluginId: 'ripple',
      currencyCode: 'XRP',
      decimals: 6,
      toAddress: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
      toMemos: [{ type: 'number', value: '12345' }]
    })

    const quote = await fetchQuote({
      fromWallet: ethWallet,
      toWallet: xrpDestination,
      fromTokenId: null,
      toTokenId: null,
      nativeAmount: '100000000000000000', // 0.1 ETH
      quoteFor: 'from'
    })

    expect(quote.fromNativeAmount).is.a('string').and.not.equals('0')
    expect(capture.depositAddress).is.a('string')

    // The order carried the pasted address and the destination tag:
    expect(lastExchangeBody).is.a('string')
    const orderBody = JSON.parse(lastExchangeBody ?? '{}')
    expect(orderBody.addressTo).equals('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')
    expect(orderBody.destinationTag).equals('12345')
  })
})

/**
 * A canned `quotes` entry, in the shape the API returns.
 */
interface ScriptedQuote {
  quoteId: string
  type: string
  amountOut: number
  amountIn?: number
  min?: number
  max?: number
  minOut?: number
  maxOut?: number
  /** ISO timestamp the quote id stops being accepted. */
  validUntil?: string
  /** On a dex route: whether a token approval must be signed first. */
  requiresApproval?: boolean
}

/** The router a scripted dex order asks the source wallet to call. */
const DEX_ROUTER = '0x3333333333333333333333333333333333333333'

interface Script {
  /**
   * What the token list reports in the native coin's address field. Houdini
   * spells it `null` on most chains, as an empty string on others, and as a
   * contract-style address on TON, which is the whole point of these cases.
   */
  nativeAddress: string | null
  quotes: ScriptedQuote[]
  /**
   * HTTP statuses handed to successive `quotes` calls. The final entry repeats
   * once the list runs out, so `[429]` rate-limits forever and `[429, 200]`
   * rate-limits once.
   */
  quoteStatuses?: number[]
  /**
   * Chains the provider lists tokens for but serves no native coin on. The
   * token list still answers 200 for them, it just holds nothing that matches,
   * which is how celo, fantom and polkadot actually behave.
   */
  unservedChains?: string[]
  /**
   * The chain name token rows report, keyed by the name the query used. The
   * provider does not always echo the query: a `bitcoincash` query answers
   * with rows whose `chain` is `bch`.
   */
  chainAliases?: Record<string, string>
  /**
   * An error body the create-exchange call answers with (status 400) instead of
   * an order, for asserting how a rejection is phrased to the user.
   */
  orderError?: unknown
  /**
   * HTTP statuses handed to successive `exchanges` calls, same repeat-last rule
   * as `quoteStatuses`. A 429 answers with the rate-limit envelope and a 409
   * with the `STATIC_DEPOSIT_IN_USE` one.
   */
  orderStatuses?: number[]
  /**
   * HTTP statuses handed to successive `tokens` calls, same repeat-last rule as
   * `quoteStatuses`. A non-200 is the provider failing to answer, which must
   * not be mistaken for a miss.
   */
  tokenStatuses?: number[]
  /** Seconds the rate-limit envelope asks the caller to wait. */
  retryAfter?: number
  /**
   * Fields merged into every successful create-exchange response, for the
   * cases that need a specific order shape (an inflated `inAmount` that the
   * trust boundary has to reject, a numeric or blank `depositTag`).
   */
  orderOverrides?: { [key: string]: unknown }
  /**
   * Fields merged into the `metadata` of a dex order (any create-exchange call
   * that names `addressFrom`), for an off-chain route or an inflated value.
   */
  dexMetadata?: { [key: string]: unknown }
}

interface ScriptedRun {
  plugin: ReturnType<typeof makeHoudiniPlugin>
  /** Every `quotes` URL requested, in order. */
  quoteUrls: string[]
  /** Every `tokens` URL requested, in order, to prove lookups are cached. */
  tokenUrls: string[]
  /** Every `exchanges` body posted, in order. */
  orderBodies: string[]
  /** Every `dex/confirmTx` body posted, in order. */
  confirmBodies: string[]
  warnings: string[]
}

/**
 * A plugin whose every HTTP call is answered locally.
 *
 * The recorded-fixture tests above replay one canned answer per URL, which
 * cannot express what these cases need: a specific SEQUENCE of statuses (the
 * rate-limit backoff), or a route mix the live API will not produce on demand
 * (a pair that offers standard routes and no private one). Answering locally
 * also keeps them deterministic and free of partner-API budget.
 */
const makeScriptedPlugin = (script: Script): ScriptedRun => {
  const {
    nativeAddress,
    quotes,
    quoteStatuses = [200],
    unservedChains = [],
    chainAliases = {},
    orderError,
    orderStatuses = [200],
    tokenStatuses = [200],
    retryAfter,
    orderOverrides = {},
    dexMetadata = {}
  } = script
  const run: ScriptedRun = {
    plugin: (undefined as unknown) as ReturnType<typeof makeHoudiniPlugin>,
    quoteUrls: [],
    tokenUrls: [],
    orderBodies: [],
    confirmBodies: [],
    warnings: []
  }
  let quoteCall = 0
  let tokenCall = 0
  let orderCall = 0

  const reply = (status: number, body: unknown): FetchResponseLike => {
    const text = JSON.stringify(body)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text
    }
  }

  const scriptedFetch = async (
    url: string,
    opts: { method?: string; body?: string } = {}
  ): Promise<FetchResponseLike> => {
    const path = url.slice(url.indexOf('/v2/') + 4)

    if (path.startsWith('tokens')) {
      run.tokenUrls.push(path)
      const tokenStatus =
        tokenStatuses[Math.min(tokenCall++, tokenStatuses.length - 1)]
      if (tokenStatus !== 200) return reply(tokenStatus, { message: 'nope' })
      const chain = /chain=([^&]*)/.exec(path)?.[1] ?? ''
      if (unservedChains.includes(chain)) {
        // The provider answers, it just has no native to offer:
        return reply(200, { tokens: [] })
      }
      const rowChain = chainAliases[chain] ?? chain
      const native = {
        id: `${chain}-native`,
        address: nativeAddress,
        chain: rowChain
      }
      // `mainnet=true` answers with the chain's coin alone, as the live API
      // does, whatever that coin's address field says:
      if (path.includes('mainnet=true')) return reply(200, { tokens: [native] })
      return reply(200, {
        tokens: [
          // A contract token on the same chain, to prove an address match is
          // picking the right entry rather than the first one:
          {
            id: `${chain}-token`,
            address: '0x0000000000000000000000000000000000000001',
            chain: rowChain
          },
          native
        ]
      })
    }

    if (path.startsWith('quotes')) {
      run.quoteUrls.push(path)
      const status =
        quoteStatuses[Math.min(quoteCall++, quoteStatuses.length - 1)]
      if (status === 429) {
        return reply(429, {
          type: 'RATE_LIMIT_EXCEEDED',
          limit: 5,
          windowMs: 60000,
          ...(retryAfter == null ? {} : { retryAfter })
        })
      }
      return reply(200, { quotes })
    }

    if (path.startsWith('exchanges')) {
      run.orderBodies.push(opts.body ?? '')
      const orderStatus =
        orderStatuses[Math.min(orderCall++, orderStatuses.length - 1)]
      if (orderStatus === 429) {
        return reply(429, {
          type: 'RATE_LIMIT_EXCEEDED',
          limit: 1,
          windowMs: 60000,
          ...(retryAfter == null ? {} : { retryAfter })
        })
      }
      if (orderStatus === 409) {
        // A fixed-rate route's static deposit address held by another live
        // order. The plugin falls through to the next in-range route.
        return reply(409, {
          code: 'STATIC_DEPOSIT_IN_USE',
          message: 'Deposit address for ch BTC is in use by another live order'
        })
      }
      if (orderError != null) return reply(400, orderError)
      const orderRequest = JSON.parse(opts.body ?? '{}')
      const { quoteId } = orderRequest
      const used = quotes.find(quote => quote.quoteId === quoteId)
      if (orderRequest.addressFrom != null) {
        // A dex order: no deposit address, just the contract call the source
        // wallet signs itself.
        return reply(200, {
          houdiniId: `order-${String(quoteId)}`,
          outAmount: used?.amountOut ?? 100,
          metadata: {
            offChain: false,
            to: DEX_ROUTER,
            data: '0xabcdef',
            value: SONIC_NATIVE_AMOUNT,
            ...dexMetadata
          }
        })
      }
      return reply(200, {
        houdiniId: `order-${String(quoteId)}`,
        depositAddress: 'DEPOSIT_ADDRESS',
        inAmount: used?.amountIn ?? 100,
        outAmount: used?.amountOut ?? 100,
        ...orderOverrides
      })
    }

    if (path.startsWith('dex/confirmTx')) {
      run.confirmBodies.push(opts.body ?? '')
      return reply(200, {})
    }

    throw new Error(`Unscripted Houdini path: ${path}`)
  }

  const log = Object.assign(() => {}, {
    warn: (...args: unknown[]) => {
      run.warnings.push(args.map(String).join(' '))
    },
    error: () => {},
    crash: async () => {},
    breadcrumb: () => {}
  })

  run.plugin = makeHoudiniPlugin(({
    initOptions: { apiKey: 'SCRIPTED', apiSecret: 'SCRIPTED' },
    io: { fetch: scriptedFetch, fetchCors: scriptedFetch },
    log
  } as unknown) as Parameters<typeof makeHoudiniPlugin>[0])

  return run
}

describe('houdini offline behaviors', function () {
  // The rate-limit cases wait out the plugin's own backoff (1s, 2s, 4s):
  this.timeout(30000)

  const capture: SpendCapture = {}

  /** Sonic and Stellar are two of the empty-string-native chains. */
  const sonicWallet = makeFakeWallet(
    {
      pluginId: 'sonic',
      currencyCode: 'S',
      decimals: 18,
      address: '0x1111111111111111111111111111111111111111',
      balance: SONIC_NATIVE_AMOUNT,
      evmChainId: 146
    },
    capture
  )
  const stellarWallet = makeFakeWallet(
    {
      pluginId: 'stellar',
      currencyCode: 'XLM',
      decimals: 7,
      address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    },
    capture
  )
  const celoWallet = makeFakeWallet(
    {
      pluginId: 'celo',
      currencyCode: 'CELO',
      decimals: 18,
      address: '0x2222222222222222222222222222222222222222'
    },
    capture
  )

  const privateQuote: ScriptedQuote = {
    quoteId: 'q-private',
    type: 'private',
    amountOut: 150,
    amountIn: 1300
  }
  const standardQuote: ScriptedQuote = {
    quoteId: 'q-standard',
    type: 'standard',
    amountOut: 160,
    amountIn: 1300
  }
  const dexQuote: ScriptedQuote = {
    quoteId: 'q-dex',
    type: 'dex',
    amountOut: 170,
    amountIn: 1300
  }

  const quoteSonicToStellar = async (
    run: ScriptedRun,
    overrides: Partial<EdgeSwapRequest> = {}
  ): Promise<EdgeSwapQuote> => {
    capture.depositAddress = undefined
    capture.savedAction = undefined
    const request = ({
      fromWallet: sonicWallet,
      toWallet: stellarWallet,
      fromTokenId: null,
      toTokenId: null,
      nativeAmount: SONIC_NATIVE_AMOUNT,
      quoteFor: 'from',
      ...overrides
    } as unknown) as EdgeSwapRequest
    return await run.plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })
  }

  it('resolves a native coin whose contract address is an empty string', async function () {
    // Both sides of this pair are chains Houdini reports with `address: ""`,
    // and `"" == null` is false, so a native lookup that tests the address
    // finds nothing for either and every quote fails before reaching the
    // provider.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote]
    })
    const quote = await quoteSonicToStellar(run)

    expect(quote.pluginId).equals('houdini')
    expect(capture.depositAddress).equals('DEPOSIT_ADDRESS')
    expect(run.quoteUrls[0]).contains('from=sonic-native')
    expect(run.quoteUrls[0]).contains('to=xlm-native')
  })

  it('resolves a native coin whose contract address is null', async function () {
    const run = makeScriptedPlugin({
      nativeAddress: null,
      quotes: [privateQuote]
    })
    await quoteSonicToStellar(run)
    expect(run.quoteUrls[0]).contains('from=sonic-native')
  })

  it('resolves a native coin that carries a contract-style address', async function () {
    // TON's coin is listed with an address (`EQAA...M9c`) exactly like a
    // token. The lookup asks for the chain's coin with `mainnet=true`, so the
    // row it gets back is the native whatever its address field holds.
    const run = makeScriptedPlugin({
      nativeAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
      quotes: [privateQuote]
    })
    await quoteSonicToStellar(run)
    expect(run.quoteUrls[0]).contains('from=sonic-native')
    expect(run.quoteUrls[0]).contains('to=xlm-native')
  })

  it('resolves a native coin whose rows name the chain differently', async function () {
    // The provider does not always echo the chain it was asked about: a
    // `bitcoincash` query answers with rows on `bch`. A lookup that matched
    // rows against the queried name discarded the only row returned, so BCH
    // could never be quoted in either direction.
    const run = makeScriptedPlugin({
      nativeAddress: null,
      quotes: [privateQuote],
      chainAliases: { sonic: 'sonic-mainnet', xlm: 'stellar' }
    })
    await quoteSonicToStellar(run)
    expect(run.quoteUrls[0]).contains('from=sonic-native')
    expect(run.quoteUrls[0]).contains('to=xlm-native')
  })

  it('declines when privacy is required and only transparent routes exist', async function () {
    // Below Houdini's 25 USD private floor the API answers with standard and
    // dex routes only. Handing one of those to a caller that asked for privacy
    // would be a downgrade it cannot detect, so the plugin declines instead.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [standardQuote, dexQuote]
    })
    let error: unknown
    await quoteSonicToStellar(run, ({
      privacy: 'required'
    } as unknown) as Partial<EdgeSwapRequest>).catch((caught: unknown) => {
      error = caught
    })

    expect(String(error)).contains('SwapCurrencyError')
    expect(run.orderBodies).deep.equals([])
  })

  it('takes a standard route when privacy was not requested', async function () {
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [standardQuote, dexQuote]
    })
    await quoteSonicToStellar(run)
    expect(JSON.parse(run.orderBodies[0]).quoteId).equals('q-standard')
  })

  it('prefers a private route over a better-priced standard one', async function () {
    // The standard quote pays out more here. Privacy still wins the ranking,
    // because a transparent route is not a cheaper version of a private one.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [standardQuote, privateQuote]
    })
    await quoteSonicToStellar(run)
    expect(JSON.parse(run.orderBodies[0]).quoteId).equals('q-private')
  })

  it('takes a dex route for a plain send from a native EVM coin', async function () {
    // Some destinations are served by dex routes alone (every route into
    // Monad is one). A plain request takes one when nothing else is on offer:
    // the wallet signs the router call itself and reports the txid after.
    const run = makeScriptedPlugin({ nativeAddress: '', quotes: [dexQuote] })
    const quote = await quoteSonicToStellar(run)

    const orderBody = JSON.parse(run.orderBodies[0])
    expect(orderBody.quoteId).equals('q-dex')
    expect(orderBody.addressFrom).equals(
      '0x1111111111111111111111111111111111111111'
    )
    expect(capture.depositAddress).equals(DEX_ROUTER)
    expect(capture.nativeAmount).equals(SONIC_NATIVE_AMOUNT)
    expect(capture.memos).deep.equals([{ type: 'hex', value: 'abcdef' }])

    await quote.approve()
    expect(JSON.parse(run.confirmBodies[0])).deep.equals({
      id: 'order-q-dex',
      txHash: '0xtxhash'
    })
  })

  it('declines a dex route that needs a token approval first', async function () {
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [{ ...dexQuote, requiresApproval: true }]
    })
    let error: unknown
    await quoteSonicToStellar(run).catch((caught: unknown) => {
      error = caught
    })
    expect(String(error)).contains('SwapCurrencyError')
    expect(run.orderBodies).deep.equals([])
  })

  it('declines a dex route from a coin on a chain that is not EVM', async function () {
    const run = makeScriptedPlugin({ nativeAddress: '', quotes: [dexQuote] })
    let error: unknown
    await quoteSonicToStellar(run, {
      fromWallet: stellarWallet,
      toWallet: sonicWallet,
      nativeAmount: '100000000'
    }).catch((caught: unknown) => {
      error = caught
    })
    expect(String(error)).contains('SwapCurrencyError')
    expect(run.orderBodies).deep.equals([])
  })

  it('declines a dex route that Houdini would broadcast itself', async function () {
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [dexQuote],
      dexMetadata: { offChain: true }
    })
    let error: unknown
    await quoteSonicToStellar(run).catch((caught: unknown) => {
      error = caught
    })
    expect(String(error)).contains('needs a step Edge cannot sign')
  })

  it('refuses a dex transaction value above the requested amount', async function () {
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [dexQuote],
      dexMetadata: { value: '1300000000000000000001' }
    })
    let error: unknown
    await quoteSonicToStellar(run).catch((caught: unknown) => {
      error = caught
    })
    expect(String(error)).contains('above the requested amount')
  })

  it('allows a same-asset swap, which is this provider main flow', async function () {
    // The shared `checkInvalidTokenIds` guard rejects same-asset requests for
    // every other plugin. Routing an asset to itself through the mixer is what
    // Houdini is for, so it opts out of that half of the guard.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote]
    })
    const quote = await quoteSonicToStellar(run, {
      toWallet: sonicWallet
    })
    expect(quote.pluginId).equals('houdini')
  })

  it('declines a chain the provider serves no native coin for', async function () {
    // Houdini lists celo, fantom and polkadot but has no mainnet native for
    // any of them. The chain table does not encode that: the decline comes
    // from the token lookup finding nothing, which is the same
    // `SwapCurrencyError` the whitelist check raises, so the aggregator moves
    // on to another provider either way.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      unservedChains: ['celo']
    })
    let error: unknown
    await quoteSonicToStellar(run, { toWallet: celoWallet }).catch(
      (caught: unknown) => {
        error = caught
      }
    )
    expect(String(error)).contains('SwapCurrencyError')
    // It declined before pricing anything:
    expect(run.quoteUrls).deep.equals([])
  })

  it('asks about an unserved chain once, then remembers', async function () {
    // The miss is the expensive part: without caching it, every quote naming
    // an unserved chain spends another call against a rate-limited API to be
    // told the same thing. Caching it is what lets the chain table stay a
    // name map instead of a hand-maintained list of what is served.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      unservedChains: ['celo']
    })
    const swallow = (): void => {}
    await quoteSonicToStellar(run, { toWallet: celoWallet }).catch(swallow)
    const afterFirst = run.tokenUrls.filter(url => url.includes('chain=celo'))
      .length
    await quoteSonicToStellar(run, { toWallet: celoWallet }).catch(swallow)
    const afterSecond = run.tokenUrls.filter(url => url.includes('chain=celo'))
      .length

    expect(afterFirst).equals(1)
    expect(afterSecond).equals(1)
  })

  it('does not cache a lookup the provider failed to answer', async function () {
    // A rate limit or a server error says nothing about whether the chain is
    // served. Caching that would turn one bad minute into a chain that stays
    // dead for the rest of the session.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      tokenStatuses: [500, 200]
    })
    const swallow = (): void => {}
    await quoteSonicToStellar(run).catch(swallow)
    const afterFailure = run.tokenUrls.length
    await quoteSonicToStellar(run).catch(swallow)

    expect(afterFailure).is.greaterThan(0)
    expect(run.tokenUrls.length).is.greaterThan(afterFailure)
  })

  it('reads the quote expiry the API actually sends', function () {
    // Live fixtures record `validUntil` as Unix SECONDS in a string
    // ("1783037880"), which `new Date` reads as an invalid date. Parsing it
    // that way silently fell back to a fresh 60s window on every quote, so
    // the expiry guard could never fire.
    const at = 1783037880
    const quote = ({ validUntil: String(at) } as unknown) as Parameters<
      typeof quoteValidUntilMs
    >[0]
    expect(quoteValidUntilMs(quote)).equals(at * 1000)

    // An absent expiry still falls back to the documented lifetime:
    const noExpiry = ({} as unknown) as Parameters<typeof quoteValidUntilMs>[0]
    expect(quoteValidUntilMs(noExpiry)).is.greaterThan(Date.now())
  })

  it('does not wait out a window that outlives the quote', async function () {
    // Houdini's one-per-minute exchange budget reports `retryAfter` near 60,
    // and a quote id lives about that long. Waiting the full window and then
    // POSTing the same quote id hangs the user for a minute only to fail as an
    // expired quote, so the rate limit is reported straight away instead.
    const start = Date.now()
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [
        {
          ...privateQuote,
          // Unix seconds in a string, exactly as the API reports it:
          validUntil: String(Math.floor((start + 20000) / 1000))
        }
      ],
      orderStatuses: [429],
      retryAfter: 60
    })
    const error = await quoteSonicToStellar(run).then(
      () => undefined,
      (error: unknown) => error
    )

    expect(String(error)).contains('rate limit')
    // It failed rather than sleeping out the window:
    expect(Date.now() - start).is.lessThan(5000)
    // And it did not burn the remaining candidates on the same dead window:
    expect(run.orderBodies.length).equals(1)
  })

  it('reads the field message out of a validation failure', async function () {
    // A `VALIDATION_ERROR` sets the top-level message to a generic "Validation
    // Failed" and puts the real reason under `fields.<name>.message`, so
    // reading the top level alone told the user nothing they could act on.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      orderError: {
        code: 'VALIDATION_ERROR',
        message: 'Validation Failed',
        fields: { quoteId: { message: 'Quote has expired' } }
      }
    })
    const error = await quoteSonicToStellar(run).then(
      () => undefined,
      (error: unknown) => error
    )

    expect(String(error)).contains('Quote has expired')
    expect(String(error)).does.not.contain('Validation Failed')
  })

  it('creates one exchange for a max quote, not two', async function () {
    // `getMaxSwappable` runs the quote function once to size the spend, then
    // the real quote runs it again. Creating an exchange on the sizing pass
    // spends one of Houdini's one-per-minute exchange slots, so the real
    // create is rate limited and the whole max quote stalls for the window.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote]
    })
    await quoteSonicToStellar(run, { quoteFor: 'max' })

    expect(run.orderBodies.length).equals(1)
  })

  it('sets skipChecks on the max probe, so EVM max swaps work', async function () {
    // The probe stands in the user's OWN from-chain address for the deposit
    // address that does not exist yet. An EVM engine compares the spend target
    // against its own public key and rejects that with `SpendToSelfError`,
    // which escapes `getMaxSwappable` and fails every max swap from an EVM
    // wallet unless the probe's spendInfo opts out of the checks.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote]
    })
    await quoteSonicToStellar(run, { quoteFor: 'max' })

    expect(capture.maxSpendInfo?.skipChecks).equals(true)
  })

  it('clamps an above-limit balance on the max probe instead of throwing', async function () {
    // The probe deliberately quotes the full PRE-FEE balance to find the
    // ceiling. Throwing `SwapAboveLimitError` there aborts a max swap that
    // fits perfectly well once the network fee comes off, so the maximum is
    // enforced on the real quote only. This wallet holds 1300 S, above the
    // route's 1000 ceiling, and reports 900 S spendable once the fee is out.
    const trimmedSonicWallet = makeFakeWallet(
      {
        pluginId: 'sonic',
        currencyCode: 'S',
        decimals: 18,
        address: '0x1111111111111111111111111111111111111111',
        balance: SONIC_NATIVE_AMOUNT,
        maxSpendable: '900000000000000000000'
      },
      capture
    )
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [{ ...privateQuote, min: 1, max: 1000 }],
      // The scripted exchange echoes the quote's `amountIn` for every request,
      // so the real (trimmed) create needs the trimmed amount spelled out. A
      // live provider prices the order off the amount it was asked for.
      orderOverrides: { inAmount: 900 }
    })

    const quote = await run.plugin.fetchSwapQuote(
      ({
        fromWallet: trimmedSonicWallet,
        toWallet: stellarWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: SONIC_NATIVE_AMOUNT,
        quoteFor: 'max'
      } as unknown) as EdgeSwapRequest,
      undefined,
      { infoPayload: {} }
    )
    expect(quote.pluginId).equals('houdini')
    expect(quote.fromNativeAmount).equals('900000000000000000000')
  })

  it('refuses an order whose deposit amount exceeds the request', async function () {
    // TRUST BOUNDARY: `inAmount` comes back from the provider and becomes a
    // signed spend, so a response asking for more of the source asset than the
    // user requested must not reach `makeSpend`.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      orderOverrides: { inAmount: 2600 }
    })

    let error: unknown
    try {
      await quoteSonicToStellar(run)
    } catch (caught: unknown) {
      error = caught
    }
    expect(String(error)).contains('above the requested amount')
  })

  it('accepts a numeric deposit tag and ignores a blank one', async function () {
    // A numeric destination tag is the common shape on memo chains, and the
    // valid tag `0` is numeric too. A string-only cleaner rejects both, taking
    // the whole order down; a blank one becomes an empty memo on the deposit.
    const numeric = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      orderOverrides: { depositTag: 0 }
    })
    await quoteSonicToStellar(numeric)
    expect(numeric.orderBodies.length).equals(1)

    const blank = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      orderOverrides: { depositTag: '' }
    })
    await quoteSonicToStellar(blank)
    expect(blank.orderBodies.length).equals(1)
  })

  it('rounds a minimum up and a maximum down', async function () {
    // A minimum that rounds DOWN lets a deposit through that the provider then
    // rejects; a maximum that rounds UP offers a ceiling the provider will not
    // honor. XLM's 7 decimals make both directions visible: each limit below
    // carries an eighth decimal place, so the native value is fractional and
    // the rounding has to pick a side.
    const quoteStellarToSonic = async (
      run: ScriptedRun,
      overrides: Partial<EdgeSwapRequest> = {}
    ): Promise<EdgeSwapQuote> =>
      await run.plugin.fetchSwapQuote(
        ({
          fromWallet: stellarWallet,
          toWallet: sonicWallet,
          fromTokenId: null,
          toTokenId: null,
          nativeAmount: '10000000', // 1 XLM
          quoteFor: 'from',
          ...overrides
        } as unknown) as EdgeSwapRequest,
        undefined,
        { infoPayload: {} }
      )

    const belowRun = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [{ ...privateQuote, min: 1.00000004, max: 1000 }]
    })
    let belowError: any
    try {
      await quoteStellarToSonic(belowRun)
    } catch (caught: unknown) {
      belowError = caught
    }
    expect(belowError?.name).equals('SwapBelowLimitError')
    // 1.00000004 XLM is 10000000.4 stroops, which rounds UP:
    expect(belowError?.nativeMin).equals('10000001')

    const aboveRun = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [{ ...privateQuote, min: 0.0001, max: 0.90000005 }]
    })
    let aboveError: any
    try {
      await quoteStellarToSonic(aboveRun)
    } catch (caught: unknown) {
      aboveError = caught
    }
    expect(aboveError?.name).equals('SwapAboveLimitError')
    // 0.90000005 XLM is 9000000.5 stroops, which rounds DOWN:
    expect(aboveError?.nativeMax).equals('9000000')
  })

  it('falls through to the next route when a deposit address is in use', async function () {
    // A fixed-rate route's static deposit address can be held by another live
    // order (409 STATIC_DEPOSIT_IN_USE). That is the one order failure worth
    // retrying on a different route, and it is recognized by the envelope's
    // machine-readable `code`, not by searching the raw body: a code that also
    // appeared inside a human-readable message would match a substring test on
    // a response that meant something else.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote, { ...privateQuote, quoteId: 'q-private-2' }],
      orderStatuses: [409, 200]
    })
    await quoteSonicToStellar(run)

    expect(run.orderBodies.length).equals(2)
    expect(JSON.parse(run.orderBodies[0]).quoteId).equals('q-private')
    expect(JSON.parse(run.orderBodies[1]).quoteId).equals('q-private-2')
  })

  it('bounds a reverse quote deposit by the route from-side ceiling', async function () {
    // A reverse quote pins the RECEIVE amount, so the send side is the
    // provider's to price and `request.nativeAmount` says nothing about it.
    // The route's own published `max` is the local bound that remains, and an
    // order asking for more than it must not become a signed spend.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [
        {
          ...privateQuote,
          amountIn: 1000,
          minOut: 0.01,
          maxOut: 1000,
          min: 1,
          max: 1200
        }
      ],
      orderOverrides: { inAmount: 5000 }
    })

    let error: unknown
    try {
      await quoteSonicToStellar(run, {
        quoteFor: 'to',
        nativeAmount: '1500000' // 0.15 XLM, inside minOut/maxOut
      })
    } catch (caught: unknown) {
      error = caught
    }
    expect(String(error)).contains('above the requested amount')
  })

  it('never retries before the window the API asked for', function () {
    // Houdini's 1-per-minute exchange budget reports `retryAfter` near 60. The
    // 30s cap on our own doubling used to truncate that, so the retry fired
    // while still inside the window, drew another 429, and spent the retries
    // for nothing.
    expect(rateLimitDelayMs(0, 60)).is.at.least(60000)
    expect(rateLimitDelayMs(2, 60)).is.at.least(60000)

    // Without a reported window the cap still bounds our own growth.
    expect(rateLimitDelayMs(0, undefined)).equals(1000)
    expect(rateLimitDelayMs(9, undefined)).equals(30000)
  })

  it('asks once when both legs of a quote want the same token', async function () {
    // A quote resolves both legs with `Promise.all`, so a same-asset quote asks
    // the same question twice at once. Caching only on completion let both
    // miss and spend two calls against a rate-limited API on one answer.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote]
    })
    const swallow = (): void => {}
    await quoteSonicToStellar(run, {
      toWallet: sonicWallet
    }).catch(swallow)

    const sonicLookups = run.tokenUrls.filter(url => url.includes('sonic'))
    expect(sonicLookups.length).equals(1)
  })

  it('blames the provider when a lookup fails, not the pair', async function () {
    // Returning a miss on a failed lookup would be indistinguishable from the
    // provider answering "no such token", so a bad minute at the API would
    // reach the user as a pair Houdini cannot route.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      tokenStatuses: [503]
    })
    const error = await quoteSonicToStellar(run).then(
      () => undefined,
      (error: unknown) => error
    )

    expect(error == null).equals(false)
    expect(String(error)).does.not.contain('SwapCurrencyError')
    expect(String(error)).contains('503')
  })

  it('reports a floating rate on a forward quote and a fixed one on a reverse quote', async function () {
    // Houdini prices exact-out on fixed-rate quotes alone. A forward quote
    // floats whether the route is private or standard, so labelling every
    // quote fixed showed a locked receive amount for a leg that can still move.
    const forward = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote]
    })
    await quoteSonicToStellar(forward)
    const forwardAction = capture.savedAction as { isEstimate?: boolean }
    expect(forwardAction.isEstimate).equals(true)

    const reverse = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [{ ...standardQuote, minOut: 0.01, maxOut: 1000 }]
    })
    await quoteSonicToStellar(reverse, {
      quoteFor: 'to',
      nativeAmount: '1500000' // 0.15 XLM, priced on the receive side
    })
    const reverseAction = capture.savedAction as { isEstimate?: boolean }
    expect(reverseAction.isEstimate).equals(false)
    expect(reverse.quoteUrls[0]).contains('amountType=receive')
    expect(reverse.quoteUrls[0]).contains('fixed=true')
  })

  it('retries a rate-limited call behind the window the API reports', async function () {
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      quoteStatuses: [429, 200],
      retryAfter: 1
    })
    const quote = await quoteSonicToStellar(run)

    expect(quote.pluginId).equals('houdini')
    expect(run.quoteUrls.length).equals(2)
    expect(run.warnings.join(' ')).contains('rate limited')
  })

  it('names the rate limit rather than the route once retries are spent', async function () {
    // A 429 must never surface as "this pair is unavailable": the pair is
    // fine, the caller was too fast, and the two failures want different
    // handling from both the user and the send scene pair-capability cache.
    const run = makeScriptedPlugin({
      nativeAddress: '',
      quotes: [privateQuote],
      quoteStatuses: [429],
      retryAfter: 0
    })
    let error: unknown
    await quoteSonicToStellar(run).catch((caught: unknown) => {
      error = caught
    })

    expect(String(error)).contains('rate limit exceeded')
    expect(String(error)).does.not.contain('SwapCurrencyError')
    // Three retries on top of the first attempt, then it gives up:
    expect(run.quoteUrls.length).equals(4)
  })
})
