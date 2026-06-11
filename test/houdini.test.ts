import { assert } from 'chai'
import { createHash } from 'crypto'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSwapRequest
} from 'edge-core-js/types'
import fs from 'fs'
import { describe, it } from 'mocha'
import path from 'path'

import { makeHoudiniPlugin } from '../src/swap/central/houdini'

/**
 * Houdini partner-API test.
 *
 * The HARD free-tier rate limits (quote 5/min, exchange 1/min) make repeated
 * live calls impractical, so every API response is cached to
 * `test/houdini/fixtures/` on first fetch and replayed afterwards. CI runs
 * entirely from fixtures with no credentials or network.
 *
 * To refresh fixtures against the live API:
 *   HOUDINI_LIVE=1 HOUDINI_API_KEY=... HOUDINI_API_SECRET=... \
 *     yarn test --grep houdini
 * (delete `test/houdini/fixtures/` first for a clean capture).
 */

const FIXTURE_DIR = path.join(__dirname, 'houdini', 'fixtures')
const LIVE = process.env.HOUDINI_LIVE === '1'

const cacheKey = (method: string, url: string, body: string): string => {
  const slug = `${method}_${url
    .replace('https://api-partner.houdiniswap.com/v2/', '')
    .replace(/[^a-z0-9]+/gi, '_')}`.slice(0, 80)
  const hash = createHash('sha1')
    .update(`${method} ${url} ${body}`)
    .digest('hex')
    .slice(0, 10)
  return `${slug}__${hash}.json`
}

interface CachedResponse {
  status: number
  body: string
}

const makeResponse = (cached: CachedResponse): any => ({
  ok: cached.status >= 200 && cached.status < 300,
  status: cached.status,
  text: async (): Promise<string> => cached.body,
  json: async (): Promise<unknown> => JSON.parse(cached.body)
})

interface FetchOpts {
  method?: string
  body?: string
  headers?: { [key: string]: string }
}

/** A `fetch` that replays cached fixtures and only hits the network on refresh. */
const cachingFetch = async (
  url: string,
  opts: FetchOpts = {}
): Promise<unknown> => {
  const method = opts.method ?? 'GET'
  const body = opts.body ?? ''
  const file = path.join(FIXTURE_DIR, cacheKey(method, url, body))

  if (fs.existsSync(file)) {
    const cached: CachedResponse = JSON.parse(fs.readFileSync(file, 'utf8'))
    return makeResponse(cached)
  }

  if (!LIVE) {
    throw new Error(
      `Houdini fixture missing for ${method} ${url}. Re-run with HOUDINI_LIVE=1 and credentials to capture it.`
    )
  }

  const response = await fetch(url, opts)
  const text = await response.text()
  const cached: CachedResponse = { status: response.status, body: text }
  // Only persist successful responses so a transient rate-limit (429) or server
  // error never poisons the replay cache.
  if (response.ok) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(cached, null, 2))
  }
  return makeResponse(cached)
}

interface MockToken {
  currencyCode: string
  multiplier: string
  contractAddress: string
}

interface MockWalletParams {
  pluginId: string
  currencyCode: string
  multiplier: string
  address: string
  tokens?: { [tokenId: string]: MockToken }
}

const makeMockWallet = (params: MockWalletParams): EdgeCurrencyWallet => {
  const { pluginId, currencyCode, multiplier, address, tokens = {} } = params

  const allTokens: { [tokenId: string]: unknown } = {}
  for (const tokenId of Object.keys(tokens)) {
    const token = tokens[tokenId]
    allTokens[tokenId] = {
      currencyCode: token.currencyCode,
      denominations: [
        { name: token.currencyCode, multiplier: token.multiplier }
      ],
      networkLocation: { contractAddress: token.contractAddress }
    }
  }

  const wallet = {
    id: `${pluginId}-wallet`,
    currencyInfo: {
      pluginId,
      currencyCode,
      denominations: [{ name: currencyCode, multiplier }]
    },
    currencyConfig: { allTokens },
    getAddresses: async (): Promise<
      Array<{ addressType: string; publicAddress: string }>
    > => [{ addressType: 'publicAddress', publicAddress: address }],
    // Echo the spendInfo back so makeSwapPluginQuote can read the swap action.
    makeSpend: async (spendInfo: any): Promise<any> => ({
      networkFee: '0',
      tokenId: spendInfo.tokenId,
      spendTargets: spendInfo.spendTargets,
      savedAction: spendInfo.savedAction,
      assetAction: spendInfo.assetAction
    })
  }
  return (wallet as unknown) as EdgeCurrencyWallet
}

const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const ETH_ADDRESS = '0x9f1f9a5c0f1d9a5c0f1d9a5c0f1d9a5c0f1d9a5c'
const USDC_TOKEN_ID = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const btcWallet = makeMockWallet({
  pluginId: 'bitcoin',
  currencyCode: 'BTC',
  multiplier: '100000000',
  address: BTC_ADDRESS
})

const ethWallet = makeMockWallet({
  pluginId: 'ethereum',
  currencyCode: 'ETH',
  multiplier: '1000000000000000000',
  address: ETH_ADDRESS,
  tokens: {
    [USDC_TOKEN_ID]: {
      currencyCode: 'USDC',
      multiplier: '1000000',
      contractAddress: '0xA0b86991c6218b36C1d19D4a2e9Eb0cE3606eB48'
    }
  }
})

const makePlugin = (): ReturnType<typeof makeHoudiniPlugin> => {
  const opts = {
    initOptions: {
      apiKey: process.env.HOUDINI_API_KEY ?? '',
      apiSecret: process.env.HOUDINI_API_SECRET ?? ''
    },
    io: { fetch: cachingFetch },
    log: Object.assign(() => undefined, {
      warn: () => undefined,
      error: () => undefined
    })
  }
  return makeHoudiniPlugin((opts as unknown) as EdgeCorePluginOptions)
}

describe('houdini swap quote + exchange', function () {
  it('BTC -> ETH (private)', async function () {
    this.timeout(60000) // Live capture is slow; replay from fixtures is instant.
    const plugin = makePlugin()
    const request: EdgeSwapRequest = {
      fromWallet: btcWallet,
      toWallet: ethWallet,
      fromTokenId: null,
      toTokenId: null,
      nativeAmount: '1000000', // 0.01 BTC
      quoteFor: 'from'
    }

    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    assert.equal(quote.pluginId, 'houdini')
    assert.isTrue(
      quote.toNativeAmount !== '0' && quote.toNativeAmount.length > 0
    )
    assert.equal(quote.fromNativeAmount, '1000000')
  })

  it('ETH -> USDC (private)', async function () {
    this.timeout(60000) // Live capture is slow; replay from fixtures is instant.
    const plugin = makePlugin()
    const request: EdgeSwapRequest = {
      fromWallet: ethWallet,
      toWallet: ethWallet,
      fromTokenId: null,
      toTokenId: USDC_TOKEN_ID,
      nativeAmount: '50000000000000000', // 0.05 ETH
      quoteFor: 'from'
    }

    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    assert.equal(quote.pluginId, 'houdini')
    assert.isTrue(
      quote.toNativeAmount !== '0' && quote.toNativeAmount.length > 0
    )
    assert.equal(quote.fromNativeAmount, '50000000000000000')
  })
})
