import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeLog,
  EdgeSwapPlugin,
  EdgeSwapRequest,
  EdgeTransaction
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  make0xGaslessPlugin,
  waitForMinedTxid
} from '../src/swap/defi/0x/0xGasless'
import { NATIVE_TOKEN_ADDRESS } from '../src/swap/defi/0x/constants'
import { getZeroXAsset } from '../src/swap/defi/0x/util'
import { GaslessSwapStatusResponse } from '../src/swap/defi/0x/zeroXApiTypes'

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
    initOptions: { apiKey: 'test-key' },
    log: () => {}
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

const SUBMITTED_HASH = '0x' + 'a'.repeat(64)
const MINED_HASH = '0x' + 'b'.repeat(64)

const fakeLog: EdgeLog = Object.assign(() => {}, {
  breadcrumb: () => {},
  crash: () => {},
  error: () => {},
  warn: () => {}
})

const tx = (hash: string): { hash: string; timestamp: number } => ({
  hash,
  timestamp: 1
})

/** Hands out the scripted statuses in order, repeating the last one. */
const makeGetStatus = (
  statuses: GaslessSwapStatusResponse[]
): (() => Promise<GaslessSwapStatusResponse>) => {
  let index = 0
  return async () => statuses[Math.min(index++, statuses.length - 1)]
}

const waitFast = async (
  statuses: GaslessSwapStatusResponse[],
  timeoutMs: number = 1000
): Promise<string> =>
  await waitForMinedTxid({
    getStatus: makeGetStatus(statuses),
    log: fakeLog,
    pollMs: 1,
    timeoutMs
  })

const catchError = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise
  } catch (error: unknown) {
    if (error instanceof Error) return error
  }
  throw new Error('Expected a rejection')
}

describe('0xgasless waitForMinedTxid', function () {
  it('keeps polling through submitted and returns the mined hash', async function () {
    const txid = await waitFast([
      { status: 'pending', transactions: [] },
      { status: 'submitted', transactions: [tx(MINED_HASH)] },
      { status: 'succeeded', transactions: [tx(MINED_HASH)] }
    ])
    assert.equal(txid, MINED_HASH)
  })

  it('returns the mined hash when the relayer replaced the submitted one', async function () {
    const txid = await waitFast([
      { status: 'submitted', transactions: [tx(SUBMITTED_HASH)] },
      {
        status: 'submitted',
        transactions: [tx(SUBMITTED_HASH), tx(MINED_HASH)]
      },
      { status: 'succeeded', transactions: [tx(MINED_HASH)] }
    ])
    assert.equal(txid, MINED_HASH)
  })

  it('throws the reason on failed, even with no transactions', async function () {
    const error = await catchError(
      waitFast([
        { status: 'submitted', transactions: [tx(SUBMITTED_HASH)] },
        { status: 'failed', transactions: [], reason: 'order_expired' }
      ])
    )
    assert.equal(error.message, 'Swap failed: order_expired')
  })

  it('times out when the trade never mines', async function () {
    const error = await catchError(
      waitFast(
        [{ status: 'submitted', transactions: [tx(SUBMITTED_HASH)] }],
        20
      )
    )
    assert.match(error.message, /^Swap timed out after 0.02 seconds/)
    assert.include(error.message, `submitted [${SUBMITTED_HASH}]`)
  })
})

describe('0xgasless approve', function () {
  it('saves the swap under the mined hash, not the submitted one', async function () {
    this.timeout(5000)
    const getStatus = makeGetStatus([
      { status: 'submitted', transactions: [tx(SUBMITTED_HASH)] },
      { status: 'succeeded', transactions: [tx(MINED_HASH)] }
    ])
    const respond = (body: unknown): unknown => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body)
    })
    const plugin = make0xGaslessPlugin(({
      io: {
        fetch: async (uri: string) => {
          if (uri.includes('/gasless/quote')) {
            return respond(makeQuote('1000000', '1129000'))
          }
          if (uri.includes('/gasless/submit')) {
            return respond({
              type: 'settler_metatransaction',
              tradeHash: '0x3'
            })
          }
          return respond(await getStatus())
        }
      },
      initOptions: { apiKey: 'test-key' },
      log: () => {}
    } as unknown) as EdgeCorePluginOptions) as EdgeSwapPlugin

    const savedTxs: EdgeTransaction[] = []
    const arc = makeWallet('arc', 'USDC')
    const wallet = {
      ...arc,
      currencyInfo: {
        ...arc.currencyInfo,
        transactionExplorer: 'https://arcscan.app/tx/%s'
      },
      async signMessage() {
        return '0x' + '1'.repeat(64) + '2'.repeat(64) + '1b'
      },
      async saveTx(transaction: EdgeTransaction) {
        savedTxs.push(transaction)
      }
    }
    const quote = await plugin.fetchSwapQuote(
      {
        ...makeRequest(EURC_TOKEN_ID, null, '1000000'),
        fromWallet: wallet,
        toWallet: wallet
      },
      undefined,
      { infoPayload: {} }
    )
    const result = await quote.approve()

    assert.equal(result.orderId, MINED_HASH)
    assert.equal(
      result.transaction.savedAction?.actionType === 'swap'
        ? result.transaction.savedAction.orderUri
        : undefined,
      `https://arcscan.app/tx/${MINED_HASH}`
    )
    assert.equal(result.transaction.txid, MINED_HASH)
    assert.equal(savedTxs.length, 1)
    assert.equal(savedTxs[0].txid, MINED_HASH)
  })
})
