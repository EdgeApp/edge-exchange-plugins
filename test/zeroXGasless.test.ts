import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSwapPlugin,
  EdgeSwapRequest
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { make0xGaslessPlugin } from '../src/swap/defi/0x/0xGasless'
import { NATIVE_TOKEN_ADDRESS } from '../src/swap/defi/0x/constants'
import { getZeroXAsset } from '../src/swap/defi/0x/util'

const ARC_INTERFACE = '0x3600000000000000000000000000000000000000'
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
const EURC_TOKEN_ID = 'bef5f6d51cb62b58e6a8f77868681825c6fe21c1'
const OUR_ADDRESS = '0x8feec0972935bb18402d0031d448135f7e0a2813'

const makeWallet = (pluginId: string, currencyCode: string): any => {
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier: '1' + '0'.repeat(18) }]
  }
  return {
    id: `${pluginId}-wallet`,
    balanceMap: new Map(),
    currencyInfo,
    currencyConfig: {
      currencyInfo,
      allTokens: {
        [EURC_TOKEN_ID]: {
          currencyCode: 'EURC',
          denominations: [{ name: 'EURC', multiplier: '1000000' }],
          displayName: 'EURC',
          networkLocation: { contractAddress: EURC }
        }
      }
    },
    async getReceiveAddress() {
      return { publicAddress: OUR_ADDRESS }
    }
  }
}

const arcWallet: EdgeCurrencyWallet = makeWallet('arc', 'USDC')
const baseWallet: EdgeCurrencyWallet = makeWallet('base', 'ETH')

/**
 * A liquid `/gasless/quote` answer in the shape captured from chain 5042 on
 * 2026-10-02, trimmed to the fields the plugin reads. Amounts are 0x's.
 */
const makeQuote = (sellAmount: string, buyAmount: string): unknown => ({
  liquidityAvailable: true,
  blockNumber: '1',
  buyToken: EURC,
  minBuyAmount: buyAmount,
  sellToken: ARC_INTERFACE,
  target: '0x0000000000000000000000000000000000000001',
  buyAmount,
  sellAmount,
  zid: '0x1',
  fees: {
    integratorFee: null,
    zeroExFee: { amount: '0', token: ARC_INTERFACE, type: 'volume' },
    gasFee: { amount: '0', token: ARC_INTERFACE, type: 'gas' }
  },
  issues: { allowance: null, balance: null, simulationIncomplete: false },
  route: { fills: [], tokens: [] },
  trade: { type: 'settler_metatransaction', hash: '0x2', eip712: {} }
})

const makePlugin = (
  uris: string[],
  sellAmount: string,
  buyAmount: string
): EdgeSwapPlugin =>
  make0xGaslessPlugin(({
    io: {
      fetch: async (uri: string) => {
        uris.push(uri)
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(makeQuote(sellAmount, buyAmount))
        }
      }
    },
    initOptions: { apiKey: 'test-key' }
  } as unknown) as EdgeCorePluginOptions) as EdgeSwapPlugin

const makeRequest = (
  fromTokenId: string | null,
  toTokenId: string | null,
  nativeAmount: string
): EdgeSwapRequest => ({
  fromWallet: arcWallet,
  toWallet: arcWallet,
  fromTokenId,
  toTokenId,
  nativeAmount,
  quoteFor: 'from'
})

describe('0x getZeroXAsset', function () {
  it("resolves Arc's native asset to the USDC interface at 6 decimals", function () {
    assert.deepEqual(getZeroXAsset(arcWallet, null), {
      address: ARC_INTERFACE,
      scale: '1000000000000'
    })
  })

  it('resolves an ordinary native asset to the ERC-7528 address', function () {
    assert.deepEqual(getZeroXAsset(baseWallet, null), {
      address: NATIVE_TOKEN_ADDRESS,
      scale: '1'
    })
  })

  it('resolves a token to its contract', function () {
    assert.deepEqual(getZeroXAsset(arcWallet, EURC_TOKEN_ID), {
      address: EURC,
      scale: '1'
    })
  })
})

describe('0xgasless fetchSwapQuote on Arc', function () {
  it('sells native USDC as the interface token, floored to 6 decimals', async function () {
    const uris: string[] = []
    const plugin = makePlugin(uris, '2000000', '1768448')
    const quote = await plugin.fetchSwapQuote(
      // 2.0000009 USDC in the wallet's 18 decimals:
      makeRequest(null, EURC_TOKEN_ID, '2000000900000000000'),
      undefined,
      { infoPayload: {} }
    )

    const params = new URL(uris[0]).searchParams
    assert.equal(params.get('chainId'), '5042')
    assert.equal(params.get('sellToken'), ARC_INTERFACE)
    assert.equal(params.get('swapFeeToken'), ARC_INTERFACE)
    assert.equal(params.get('buyToken'), EURC)
    assert.equal(params.get('sellAmount'), '2000000')

    assert.equal(quote.fromNativeAmount, '2000000000000000000')
    assert.equal(quote.toNativeAmount, '1768448')
  })

  it('scales the bought amount to 18 decimals when buying native USDC', async function () {
    const uris: string[] = []
    const plugin = makePlugin(uris, '1000000', '1129000')
    const quote = await plugin.fetchSwapQuote(
      makeRequest(EURC_TOKEN_ID, null, '1000000'),
      undefined,
      { infoPayload: {} }
    )

    const params = new URL(uris[0]).searchParams
    assert.equal(params.get('sellToken'), EURC)
    assert.equal(params.get('buyToken'), ARC_INTERFACE)
    assert.equal(params.get('sellAmount'), '1000000')

    assert.equal(quote.fromNativeAmount, '1000000')
    assert.equal(quote.toNativeAmount, '1129000000000000000')
  })

  it('throws SwapBelowLimitError below one interface unit', async function () {
    const plugin = makePlugin([], '0', '0')
    let error: any
    try {
      await plugin.fetchSwapQuote(
        makeRequest(null, EURC_TOKEN_ID, '999999999999'),
        undefined,
        { infoPayload: {} }
      )
    } catch (e) {
      error = e
    }
    assert.equal(error?.name, 'SwapBelowLimitError')
    assert.equal(error?.nativeMin, '1000000000000')
  })
})
