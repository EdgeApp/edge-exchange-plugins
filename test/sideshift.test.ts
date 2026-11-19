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

import { makeSideshiftPlugin } from '../src/swap/central/sideshift'

const AFFILIATE_ID = 'test-affiliate'
const BTC_ADDRESS = 'bc1qtestrefundaddress0000000000000000000000'
const ETH_ADDRESS = '0x9A5c4A9F9E6f3fC7f8E1B8B0C9d5e6A7B8C9d0E1'

const makeFakeWallet = (
  pluginId: string,
  currencyCode: string,
  address: string,
  multiplier: string
): EdgeCurrencyWallet => {
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  }
  return ({
    id: `${pluginId}-wallet`,
    currencyInfo,
    currencyConfig: {
      // `SwapCurrencyError` reads the pluginId through here.
      currencyInfo,
      allTokens: {}
    },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      return ({
        networkFee: '0',
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      } as unknown) as EdgeTransaction
    }
  } as unknown) as EdgeCurrencyWallet
}

interface SentRequest {
  path: string
  headers: Record<string, string>
  body?: Record<string, unknown>
}

/**
 * Canned replies from SideShift's v2 API for a BTC to ETH fixed-rate shift.
 * Records the headers and body of every request the plugin sends.
 */
const makeFakeIo = (
  sent: SentRequest[]
): Pick<EdgeCorePluginOptions['io'], 'fetchCors'> => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const replies: Record<string, unknown> = {
    '/coins': [
      { coin: 'BTC', networks: ['bitcoin'], mainnet: 'bitcoin' },
      { coin: 'ETH', networks: ['ethereum'], mainnet: 'ethereum' }
    ],
    '/pair/BTC-bitcoin/ETH-ethereum': {
      rate: '20',
      min: '0.0001',
      max: '10',
      depositCoin: 'BTC',
      depositNetwork: 'bitcoin',
      settleCoin: 'ETH',
      settleNetwork: 'ethereum'
    },
    '/permissions': { createShift: true },
    '/quotes': { id: 'quote-1' },
    '/shifts/fixed': {
      id: 'order-1',
      expiresAt,
      depositAddress: 'bc1qsideshiftdepositaddress000000000000000',
      depositAmount: '0.01',
      settleAmount: '0.2'
    }
  }

  const fetchCors = async (
    uri: string,
    opts: { headers: Record<string, string>; body?: string }
  ): Promise<unknown> => {
    const path = uri.replace('https://sideshift.ai/api/v2', '')
    sent.push({
      path,
      headers: opts.headers,
      body: opts.body == null ? undefined : JSON.parse(opts.body)
    })
    const reply = replies[path]
    if (reply == null) throw new Error(`Unexpected request to ${path}`)
    return { ok: true, status: 200, json: async () => reply }
  }
  return ({ fetchCors } as unknown) as Pick<
    EdgeCorePluginOptions['io'],
    'fetchCors'
  >
}

const makePlugin = (
  sent: SentRequest[],
  initOptions: object = { affiliateId: AFFILIATE_ID }
): EdgeSwapPlugin =>
  makeSideshiftPlugin(({
    io: makeFakeIo(sent),
    initOptions,
    log: { warn() {} }
  } as unknown) as EdgeCorePluginOptions)

const request: EdgeSwapRequest = {
  fromWallet: makeFakeWallet('bitcoin', 'BTC', BTC_ADDRESS, '100000000'),
  fromTokenId: null,
  toWallet: makeFakeWallet(
    'ethereum',
    'ETH',
    ETH_ADDRESS,
    '1000000000000000000'
  ),
  toTokenId: null,
  nativeAmount: '1000000',
  quoteFor: 'from'
}

describe('sideshift', function () {
  it('sends no secret header, even when the host passes one', async function () {
    const sent: SentRequest[] = []
    const plugin = makePlugin(sent, {
      affiliateId: AFFILIATE_ID,
      privateKey: 'must-not-be-sent'
    })

    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    assert.equal(quote.fromNativeAmount, '1000000')
    assert.includeMembers(
      sent.map(request => request.path),
      [
        '/pair/BTC-bitcoin/ETH-ethereum',
        '/permissions',
        '/quotes',
        '/shifts/fixed'
      ]
    )
    for (const { path, headers } of sent) {
      assert.deepEqual(
        headers,
        { 'Content-Type': 'application/json' },
        `headers for ${path}`
      )
    }
  })

  it('identifies Edge by its affiliateId alone', async function () {
    const sent: SentRequest[] = []
    await makePlugin(sent).fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    const posts = sent.filter(request => request.body != null)
    assert.deepEqual(
      posts.map(request => request.path),
      ['/quotes', '/shifts/fixed']
    )
    for (const { body } of posts) {
      assert.equal(body?.affiliateId, AFFILIATE_ID)
    }
  })

  it('refuses to load without an affiliateId', function () {
    assert.throws(() => makePlugin([], {}))
  })
})
