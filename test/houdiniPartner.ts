/**
 * Standalone acceptance harness for the HoudiniSwap prototype plugin.
 *
 * Runs the real `makeHoudiniPlugin` quote -> create-exchange flow for
 * BTC -> ETH and ETH -> USDC. Every Houdini API response is cached to disk
 * (`test/houdiniFixtures/`) on first fetch and replayed afterwards, so repeat
 * runs make zero live calls and stay inside the free-tier budget (5/min, 20/hr,
 * 50/day quotes; 1/min, 5/hr, 10/day exchanges). On a live first run, a single
 * backoff retry handles the 1-per-minute exchange limit.
 *
 * Credentials come from `testconfig.json` -> `HOUDINI_INIT`, the same way other
 * partners are wired. The on-device pieces a swap quote does not depend on
 * (address derivation, `makeSpend`) are stubbed; the harness exercises token
 * resolution, quoting, order creation, and `SwapOrder` construction against the
 * live API / cached fixtures.
 *
 * Run with: `node -r sucrase/register test/houdiniPartner.ts`
 */

import { makeConfig } from 'cleaner-config'
import { createHash } from 'crypto'
import {
  EdgeCurrencyWallet,
  EdgeSwapQuote,
  EdgeSwapRequest
} from 'edge-core-js/types'
import fs from 'fs'
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

/**
 * Disk-caching fetch. Replays a saved fixture when present; otherwise hits the
 * live API, persists the response, and (for create-exchange) retries once on a
 * rate-limit response after the server-reported backoff.
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
  const file = fixturePath(method, url, body)

  if (fs.existsSync(file)) {
    const cached: CachedResponse = JSON.parse(fs.readFileSync(file, 'utf8'))
    console.log(`  [cache] ${method} ${url.replace(/^.*\/v2\//, 'v2/')}`)
    return toResponse(cached)
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    console.log(`  [live]  ${method} ${url.replace(/^.*\/v2\//, 'v2/')}`)
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
        console.log(`  [retry] rate limited, waiting ${retryAfter + 2}s`)
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

// Records the last spend the plugin built, so the harness can prove the order's
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
  const wallet = {
    id: `${pluginId}-wallet`,
    currencyInfo: {
      pluginId,
      currencyCode,
      denominations: [{ name: currencyCode, multiplier }]
    },
    currencyConfig: { allTokens: tokens },
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
  // The harness only needs the wallet surface the plugin and swap helpers touch.
  return (wallet as unknown) as EdgeCurrencyWallet
}

async function main(): Promise<void> {
  // Live calls need real credentials from `testconfig.json` -> `HOUDINI_INIT`.
  // Cache hits do not (the fixture key ignores headers), so committed fixtures
  // replay anywhere with placeholder credentials.
  const initOptions =
    config.HOUDINI_INIT === false
      ? { apiKey: 'CACHE_REPLAY', apiSecret: 'CACHE_REPLAY' }
      : config.HOUDINI_INIT
  if (config.HOUDINI_INIT === false) {
    console.log(
      'No HOUDINI_INIT in testconfig.json; replaying cached fixtures only.'
    )
  }

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

  const cases: Array<{
    label: string
    request: EdgeSwapRequest
  }> = [
    {
      label: 'BTC -> ETH (0.05 BTC)',
      request: {
        fromWallet: btcWallet,
        toWallet: ethWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '5000000', // 0.05 BTC
        quoteFor: 'from'
      }
    },
    {
      label: 'ETH -> USDC (0.3 ETH)',
      request: {
        fromWallet: ethWallet,
        toWallet: ethWallet,
        fromTokenId: null,
        toTokenId: usdcTokenId,
        nativeAmount: '300000000000000000', // 0.3 ETH
        quoteFor: 'from'
      }
    }
  ]

  let failures = 0
  for (const { label, request } of cases) {
    console.log(`\n=== ${label} ===`)
    try {
      const quote: EdgeSwapQuote = await plugin.fetchSwapQuote(
        request,
        undefined,
        { infoPayload: {} }
      )
      const { fromNativeAmount, toNativeAmount, expirationDate } = quote
      const depositAddress: string | undefined = capture.depositAddress
      if (fromNativeAmount == null || toNativeAmount == null) {
        throw new Error('Quote missing amounts')
      }
      if (depositAddress == null) {
        throw new Error('Order did not produce a deposit address')
      }
      console.log(
        `  PASS  depositAddress=${depositAddress} fromNativeAmount=${fromNativeAmount} toNativeAmount=${toNativeAmount} expires=${String(
          expirationDate
        )}`
      )
    } catch (error: unknown) {
      failures++
      console.log(`  FAIL  ${String(error)}`)
    }
  }

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} (${
      cases.length
    } cases)`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.log(String(error))
  process.exit(1)
})
