import { assert } from 'chai'
import {
  asMaybeInsufficientFundsError,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeTransaction,
  EdgeTxAction,
  InsufficientFundsError
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { EdgeSwapQuotePlugin, EdgeSwapRequestPlugin } from '../src/swap/types'
import { makeSwapPluginQuote, SwapOrder } from '../src/util/swapHelpers'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'fake',
  displayName: 'Fake',
  supportEmail: 'support@example.com'
}

const savedAction = ({
  actionType: 'swap',
  swapInfo,
  orderId: 'order-1',
  isEstimate: true,
  fromAsset: { pluginId: 'bitcoin', tokenId: null, nativeAmount: '1000' },
  toAsset: { pluginId: 'ethereum', tokenId: null, nativeAmount: '2000' },
  payoutAddress: '0xpayout',
  payoutWalletId: 'to-wallet'
} as unknown) as EdgeTxAction

const fundedTx = (networkFee: string): EdgeTransaction =>
  (({
    networkFee,
    savedAction,
    tokenId: null,
    txid: 'txid-1'
  } as unknown) as EdgeTransaction)

interface FakeWalletOpts {
  makeSpend?: (spendInfo: EdgeSpendInfo) => Promise<EdgeTransaction>
  makeTx?: () => Promise<EdgeTransaction>
}

interface FakeWallet {
  broadcasts: number
  request: EdgeSwapRequestPlugin
  spends: EdgeSpendInfo[]
}

const makeRequest = (
  opts: FakeWalletOpts,
  allowInsufficientFunds?: boolean
): FakeWallet => {
  const spends: EdgeSpendInfo[] = []
  const out: FakeWallet = {
    broadcasts: 0,
    spends,
    request: ({
      allowInsufficientFunds,
      fromCurrencyCode: 'BTC',
      fromTokenId: null,
      fromWallet: {
        currencyInfo: { currencyCode: 'BTC', pluginId: 'bitcoin' },
        async broadcastTx(tx: EdgeTransaction) {
          out.broadcasts++
          return tx
        },
        async makeSpend(spendInfo: EdgeSpendInfo) {
          spends.push(spendInfo)
          if (opts.makeSpend == null) throw new Error('makeSpend not faked')
          return await opts.makeSpend(spendInfo)
        },
        otherMethods: { makeTx: opts.makeTx },
        async saveTx() {},
        async signTx(tx: EdgeTransaction) {
          return tx
        }
      },
      nativeAmount: '1000',
      quoteFor: 'from',
      toCurrencyCode: 'ETH',
      toTokenId: null,
      toWallet: { id: 'to-wallet' }
    } as unknown) as EdgeSwapRequestPlugin
  }
  return out
}

const makeOrder = (request: EdgeSwapRequestPlugin): SwapOrder => ({
  fromNativeAmount: '1000',
  request,
  spendInfo: {
    tokenId: null,
    savedAction,
    spendTargets: [{ publicAddress: 'deposit', nativeAmount: '1000' }]
  },
  swapInfo
})

const getError = async (run: () => Promise<unknown>): Promise<unknown> =>
  await run().then(
    () => undefined,
    (error: unknown) => error
  )

describe('makeSwapPluginQuote', function () {
  it('rethrows a shortfall when the request does not opt in', async function () {
    const wallet = makeRequest({
      makeSpend: async () => {
        throw new InsufficientFundsError({ tokenId: null })
      }
    })
    const error = await getError(
      async () => await makeSwapPluginQuote(makeOrder(wallet.request))
    )
    assert.isNotNull(asMaybeInsufficientFundsError(error))
    assert.lengthOf(wallet.spends, 1)
  })

  it('rethrows other failures when the request opts in', async function () {
    const wallet = makeRequest(
      {
        makeSpend: async () => {
          throw new Error('engine offline')
        }
      },
      true
    )
    const error = await getError(
      async () => await makeSwapPluginQuote(makeOrder(wallet.request))
    )
    assert.strictEqual((error as Error).message, 'engine offline')
    assert.lengthOf(wallet.spends, 1)
  })

  it('leaves a funded quote unflagged and approvable', async function () {
    const wallet = makeRequest({ makeSpend: async () => fundedTx('50') }, true)
    const quote: EdgeSwapQuotePlugin = await makeSwapPluginQuote(
      makeOrder(wallet.request)
    )
    assert.isUndefined(quote.insufficientFunds)
    assert.strictEqual(quote.networkFee.nativeAmount, '50')
    await quote.approve()
    assert.strictEqual(wallet.broadcasts, 1)
  })

  it('prices a short order from a build without balance checks', async function () {
    const wallet = makeRequest(
      {
        makeSpend: async spendInfo => {
          if (spendInfo.skipChecks !== true) {
            throw new InsufficientFundsError({ tokenId: null })
          }
          return fundedTx('75')
        }
      },
      true
    )
    const quote: EdgeSwapQuotePlugin = await makeSwapPluginQuote(
      makeOrder(wallet.request)
    )
    assert.deepEqual(quote.insufficientFunds, {
      tokenId: null,
      networkFee: undefined
    })
    assert.strictEqual(quote.fromNativeAmount, '1000')
    assert.strictEqual(quote.toNativeAmount, '2000')
    assert.strictEqual(quote.isEstimate, true)
    assert.strictEqual(quote.networkFee.nativeAmount, '75')
  })

  it('reads the fee from the shortfall when the engine still refuses', async function () {
    const wallet = makeRequest(
      {
        makeSpend: async () => {
          throw new InsufficientFundsError({
            tokenId: null,
            networkFee: '33'
          })
        }
      },
      true
    )
    const quote: EdgeSwapQuotePlugin = await makeSwapPluginQuote(
      makeOrder(wallet.request)
    )
    assert.lengthOf(wallet.spends, 2)
    assert.strictEqual(wallet.spends[1].skipChecks, true)
    assert.strictEqual(quote.toNativeAmount, '2000')
    assert.strictEqual(quote.networkFee.nativeAmount, '33')
    assert.strictEqual(quote.insufficientFunds?.networkFee, '33')
  })

  it('reports a zero fee when neither source has one', async function () {
    const wallet = makeRequest(
      {
        makeSpend: async () => {
          throw new InsufficientFundsError({ tokenId: null })
        }
      },
      true
    )
    const quote = await makeSwapPluginQuote(makeOrder(wallet.request))
    assert.strictEqual(quote.networkFee.nativeAmount, '0')
  })

  it('quotes a short makeTx order from its saved action', async function () {
    const wallet = makeRequest(
      {
        makeTx: async () => {
          throw new InsufficientFundsError({ tokenId: 'gas-token' })
        }
      },
      true
    )
    const order: SwapOrder = {
      fromNativeAmount: '1000',
      makeTxParams: ({
        type: 'MakeTxDexSwap',
        savedAction
      } as unknown) as Extract<
        SwapOrder,
        { makeTxParams: unknown }
      >['makeTxParams'],
      request: wallet.request,
      swapInfo
    }
    const quote: EdgeSwapQuotePlugin = await makeSwapPluginQuote(order)
    assert.strictEqual(quote.toNativeAmount, '2000')
    assert.strictEqual(quote.insufficientFunds?.tokenId, 'gas-token')
  })

  it('never broadcasts when approving a short quote', async function () {
    const wallet = makeRequest(
      {
        makeSpend: async spendInfo => {
          if (spendInfo.skipChecks !== true) {
            throw new InsufficientFundsError({ tokenId: null })
          }
          return fundedTx('75')
        }
      },
      true
    )
    const quote = await makeSwapPluginQuote(makeOrder(wallet.request))
    const error = await getError(async () => await quote.approve())
    assert.isNotNull(asMaybeInsufficientFundsError(error))
    assert.strictEqual(wallet.broadcasts, 0)
  })
})
