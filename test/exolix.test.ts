import { assert } from 'chai'
import { EdgeSwapPlugin } from 'edge-core-js'
import { describe, it } from 'mocha'

import { makeExolixPlugin } from '../src/swap/central/exolix'

interface MockResponse {
  ok: boolean
  status: number
  body: any
}

interface FetchCall {
  url: string
  init: any
}

interface WalletOpts {
  id: string
  pluginId: string
  currencyCode: string
  multiplier: string
  publicAddress: string
  addressType?: string
  evmChainId?: number
}

function makeWallet(opts: WalletOpts): any {
  const {
    id,
    pluginId,
    currencyCode,
    multiplier,
    publicAddress,
    addressType,
    evmChainId
  } = opts

  return {
    id,
    currencyInfo: {
      currencyCode,
      pluginId,
      denominations: [{ name: currencyCode, multiplier }],
      ...(evmChainId == null ? {} : { evmChainId })
    },
    currencyConfig: {
      currencyInfo: {
        pluginId
      },
      allTokens: {}
    },
    async getAddresses() {
      return [{ publicAddress, addressType }]
    },
    async makeSpend(spendInfo: any) {
      return {
        assetAction: spendInfo.assetAction,
        currencyCode,
        networkFee: '1000',
        savedAction: spendInfo.savedAction,
        tokenId: spendInfo.tokenId ?? null,
        txid: 'test-txid'
      }
    }
  }
}

function makeResponse(body: any, status: number = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    body
  }
}

function makePlugin(
  responses: MockResponse[]
): {
  plugin: EdgeSwapPlugin
  fetchCalls: FetchCall[]
} {
  const fetchCalls: FetchCall[] = []

  const plugin = makeExolixPlugin({
    initOptions: { apiKey: 'test-key' },
    io: {
      fetch: async (url: string, init: any) => {
        fetchCalls.push({ url, init })

        const response = responses.shift()
        if (response == null) throw new Error('Unexpected fetch call')

        return {
          ok: response.ok,
          status: response.status,
          async json() {
            return response.body
          }
        }
      }
    },
    log: {
      warn() {}
    }
  } as any)

  return { plugin, fetchCalls }
}

async function expectError(
  promise: Promise<unknown>,
  name: string
): Promise<any> {
  try {
    await promise
  } catch (error: any) {
    assert.equal(error.name, name)
    return error
  }
  throw new Error(`Expected ${name}`)
}

const btcWallet = makeWallet({
  id: 'btc-wallet',
  pluginId: 'bitcoin',
  currencyCode: 'BTC',
  multiplier: '100000000',
  publicAddress: 'bc1q3hwz3r7xa8eaj9ae9m64va4gaj3gktxqpwkp6q',
  addressType: 'segwitAddress'
})

const ethWallet = makeWallet({
  id: 'eth-wallet',
  pluginId: 'ethereum',
  currencyCode: 'ETH',
  multiplier: '1000000000000000000',
  publicAddress: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
  evmChainId: 1
})

describe(`exolix fetchSwapQuote`, function () {
  it('uses amount for quoteFor from and creates a quote', async function () {
    const { plugin, fetchCalls } = makePlugin([
      makeResponse({
        minAmount: 0.001,
        maxAmount: 1,
        fromAmount: 0.002,
        toAmount: 0.06,
        message: null,
        rateId: 'rate-from'
      }),
      makeResponse({
        id: 'order-from',
        amount: 0.002,
        amountTo: 0.06,
        depositAddress: 'bc1qdepositaddress',
        depositExtraId: 'memo-123'
      })
    ])

    const quote = await plugin.fetchSwapQuote(
      {
        fromWallet: btcWallet,
        toWallet: ethWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '200000',
        quoteFor: 'from'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.equal(fetchCalls.length, 2)
    assert.equal(fetchCalls[0].init.method, 'GET')
    assert.equal(fetchCalls[1].init.method, 'POST')

    const rateUrl = new URL(fetchCalls[0].url)
    assert.equal(rateUrl.pathname, '/api/v2/rate')
    assert.equal(rateUrl.searchParams.get('amount'), '0.002')
    assert.equal(rateUrl.searchParams.get('withdrawalAmount'), null)
    assert.equal(rateUrl.searchParams.get('networkFrom'), 'BTC')
    assert.equal(rateUrl.searchParams.get('networkTo'), 'evmGeneric')
    assert.equal(rateUrl.searchParams.get('networkToChainId'), '1')

    const transactionBody = JSON.parse(fetchCalls[1].init.body)
    assert.equal(transactionBody.amount, '0.002')
    assert.equal(transactionBody.withdrawalAmount, undefined)
    assert.equal(transactionBody.rateId, 'rate-from')

    assert.equal(quote.pluginId, 'exolix')
    assert.equal(quote.request.quoteFor, 'from')
    assert.equal(quote.fromNativeAmount, '200000')
    assert.equal(quote.toNativeAmount, '60000000000000000')
  })

  it('uses withdrawalAmount for quoteFor to and creates a quote', async function () {
    const { plugin, fetchCalls } = makePlugin([
      makeResponse({
        minAmount: 0.001,
        maxAmount: 1,
        withdrawMin: 0.5,
        withdrawMax: 10,
        fromAmount: 0.03,
        toAmount: 0.5,
        message: null,
        rateId: 'rate-to'
      }),
      makeResponse({
        id: 'order-to',
        amount: 0.03,
        amountTo: 0.5,
        depositAddress: 'bc1qdepositaddress',
        depositExtraId: 'memo-456'
      })
    ])

    const quote = await plugin.fetchSwapQuote(
      {
        fromWallet: btcWallet,
        toWallet: ethWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '500000000000000000',
        quoteFor: 'to'
      },
      undefined,
      { infoPayload: {} }
    )

    assert.equal(fetchCalls.length, 2)

    const rateUrl = new URL(fetchCalls[0].url)
    assert.equal(rateUrl.searchParams.get('amount'), null)
    assert.equal(rateUrl.searchParams.get('withdrawalAmount'), '0.5')

    const transactionBody = JSON.parse(fetchCalls[1].init.body)
    assert.equal(transactionBody.amount, undefined)
    assert.equal(transactionBody.withdrawalAmount, '0.5')
    assert.equal(transactionBody.rateId, 'rate-to')

    assert.equal(quote.request.quoteFor, 'to')
    assert.equal(quote.fromNativeAmount, '3000000')
    assert.equal(quote.toNativeAmount, '500000000000000000')
  })

  it('throws above-limit error when quoteFor to response is missing withdrawMax', async function () {
    const { plugin, fetchCalls } = makePlugin([
      makeResponse({
        minAmount: 0.001,
        maxAmount: 1,
        withdrawMin: 0.5,
        fromAmount: 0.03,
        toAmount: 0.5,
        message: null,
        rateId: 'rate-to'
      })
    ])

    const error = await expectError(
      plugin.fetchSwapQuote(
        {
          fromWallet: btcWallet,
          toWallet: ethWallet,
          fromTokenId: null,
          toTokenId: null,
          nativeAmount: '500000000000000000',
          quoteFor: 'to'
        },
        undefined,
        { infoPayload: {} }
      ),
      'SwapAboveLimitError'
    )

    assert.equal(error.pluginId, 'exolix')
    assert.equal(error.direction, 'to')
    assert.equal(error.nativeMax, '0')
    assert.equal(fetchCalls.length, 1)
  })

  it('turns 422 minimum response into a below-limit error for quoteFor from', async function () {
    const { plugin, fetchCalls } = makePlugin([
      makeResponse(
        {
          minAmount: 0.001,
          maxAmount: 1,
          fromAmount: 0.0001,
          toAmount: 0.003,
          message: 'Amount is below minimum'
        },
        422
      )
    ])

    const error = await expectError(
      plugin.fetchSwapQuote(
        {
          fromWallet: btcWallet,
          toWallet: ethWallet,
          fromTokenId: null,
          toTokenId: null,
          nativeAmount: '10000',
          quoteFor: 'from'
        },
        undefined,
        { infoPayload: {} }
      ),
      'SwapBelowLimitError'
    )

    assert.equal(error.pluginId, 'exolix')
    assert.equal(error.direction, 'from')
    assert.equal(error.nativeMin, '100000')
    assert.equal(fetchCalls.length, 1)
  })

  it('turns 422 minimum response into a below-limit error for quoteFor to', async function () {
    const { plugin, fetchCalls } = makePlugin([
      makeResponse(
        {
          minAmount: 0.001,
          maxAmount: 1,
          withdrawMin: 0.5,
          withdrawMax: 10,
          fromAmount: 0.03,
          toAmount: 0.5,
          message: 'Amount is below minimum'
        },
        422
      )
    ])

    const error = await expectError(
      plugin.fetchSwapQuote(
        {
          fromWallet: btcWallet,
          toWallet: ethWallet,
          fromTokenId: null,
          toTokenId: null,
          nativeAmount: '100000000000000000',
          quoteFor: 'to'
        },
        undefined,
        { infoPayload: {} }
      ),
      'SwapBelowLimitError'
    )

    assert.equal(error.pluginId, 'exolix')
    assert.equal(error.direction, 'to')
    assert.equal(error.nativeMin, '500000000000000000')
    assert.equal(fetchCalls.length, 1)
  })
})
