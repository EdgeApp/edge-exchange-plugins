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

import { makeHoudiniPlugin } from '../src/swap/central/houdini'
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
// deposit address landed on the transaction.
interface SpendCapture {
  depositAddress?: string
}

const makeFakeWallet = (
  params: {
    pluginId: string
    currencyCode: string
    decimals: number
    address: string
    tokens?: { [tokenId: string]: FakeToken }
  },
  capture: SpendCapture
): EdgeCurrencyWallet => {
  const { pluginId, currencyCode, decimals, address, tokens = {} } = params
  const multiplier = `1${'0'.repeat(decimals)}`
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  }
  const wallet = {
    id: `${pluginId}-wallet`,
    currencyInfo,
    currencyConfig: { currencyInfo, allTokens: tokens },
    getAddresses: async () => [
      { publicAddress: address, addressType: 'publicAddress' },
      { publicAddress: address, addressType: 'transparentAddress' }
    ],
    makeSpend: async (spendInfo: {
      tokenId: string | null
      spendTargets: Array<{ nativeAmount: string; publicAddress: string }>
      savedAction: unknown
    }) => {
      capture.depositAddress = spendInfo.spendTargets[0].publicAddress
      return {
        savedAction: spendInfo.savedAction,
        nativeAmount: `-${spendInfo.spendTargets[0].nativeAmount}`,
        networkFee: '0',
        tokenId: spendInfo.tokenId,
        currencyCode,
        metadata: {}
      }
    }
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
