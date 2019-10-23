// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  InsufficientFundsError,
  NoAmountSpecifiedError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { getFetchJson } from '../react-native-io.js'

const swapInfo = {
  pluginName: 'totle',
  displayName: 'Totle',

  quoteUri: 'https://api.totle.com/swap',
  supportEmail: 'support@totle.com'
}

const swapUri = 'https://api.totle.com/swap'
const tokenUri = 'https://api.totle.com/tokens'
const expirationMs = 1000 * 60 * 20

type QuoteInfo = {
  id: string,
  summary: {
    baseAsset: {
      address: string,
      symbol: string,
      decimals: string
    },
    sourceAsset: {
      address: string,
      symbol: string,
      decimals: string
    },
    sourceAmount: string,
    destinationAsset: {
      address: string,
      symbol: string,
      decimals: string
    },
    destinationAmount: string,
    notes: [],
    rate: string,
    market: {
      rate: string,
      slippage: string
    }
  },
  transactions: [
    {
      type: 'swap' | 'approve',
      id: string,
      tx: {
        to: string,
        from: string,
        value: string,
        data: string,
        gasPrice: string,
        gas: string,
        nonce?: string
      }
    }
  ]
}

function checkReply (reply: Object, request: EdgeSwapRequest) {
  if (reply.success === false) {
    const code = reply.response.code
    // unsupported tokens
    if (code === 1203) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    } else if (code === 3100) {
      throw new InsufficientFundsError()
    } else if (code === 1201) {
      throw new NoAmountSpecifiedError()
    }
  }
}

export function makeTotlePlugin (opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const fetchJson = getFetchJson(opts)

  const { partnerContract, apiKey } = initOptions

  async function call (json: any) {
    const body = JSON.stringify({
      ...json,
      partnerContract,
      apiKey
    })

    io.console.info('Totle call:', json)
    const headers = {
      'Content-Type': 'application/json'
    }
    const reply = await fetchJson(swapUri, { method: 'POST', body, headers })
    if (!reply.ok) {
      throw new Error(`Totle returned error code ${reply.status}`)
    }
    const out = reply.json
    io.console.info('Totle swap reply:', out)
    return out
  }

  async function fetchTokens () {
    const reply = await fetchJson(tokenUri, { method: 'GET' })
    if (!reply.ok) {
      throw new Error(`Totle returned error code ${reply.status}`)
    }
    const out = reply.json.tokens
    io.console.info('Totle token reply:', out)
    return out
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote (
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      const tokens = await fetchTokens()

      const fromToken = tokens.find(t => t.symbol === request.fromCurrencyCode)
      const toToken = tokens.find(t => t.symbol === request.toCurrencyCode)
      if (!fromToken || !toToken) {
        throw new SwapCurrencyError(swapInfo, fromToken, toToken)
      }

      // Grab addresses:
      const {
        publicAddress: userFromAddress
      } = await request.fromWallet.getReceiveAddress({}) //  currencyCode ?
      const {
        publicAddress: userToAddress
      } = await request.toWallet.getReceiveAddress({}) //  currencyCode ?

      // Get the estimate from the server:
      const reply = await call({
        address: userFromAddress,
        swap: {
          from: fromToken.address,
          to: toToken.address,
          [`${request.quoteFor}Amount`]: request.nativeAmount,
          strictDestination: request.quoteFor === 'to',
          destinationAddress: userToAddress
        }
      })
      checkReply(reply, request)

      const quoteInfo: QuoteInfo = reply.response

      const fromNativeAmount = quoteInfo.summary[0].sourceAmount
      const toNativeAmount = quoteInfo.summary[0].destinationAmount

      const txs = []
      let quoteId
      for (const tx of quoteInfo.transactions) {
        // Make the transaction:
        const spendInfo = {
          currencyCode: request.fromCurrencyCode,
          spendTargets: [
            {
              nativeAmount: tx.tx.value,
              publicAddress: tx.tx.to,
              otherParams: {
                uniqueIdentifier: tx.id,
                data: tx.tx.data
              }
            }
          ],
          networkFeeOption: 'custom',
          customNetworkFee: {
            gasLimit: tx.tx.gas,
            gasPrice: String(parseInt(tx.tx.gasPrice) / 1000000000)
          }
        }

        const transaction: EdgeTransaction = await request.fromWallet.makeSpend(
          spendInfo
        )
        if (transaction.otherParams == null) transaction.otherParams = {}
        if (tx.type === 'swap') {
          quoteId = tx.id

          transaction.otherParams.payinAddress =
            spendInfo.spendTargets[0].publicAddress
          transaction.otherParams.uniqueIdentifier =
            spendInfo.spendTargets[0].otherParams.uniqueIdentifier
        }

        txs.push(transaction)
      }

      const quote = makeTotleSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        txs,
        userToAddress,
        'totle',
        new Date(Date.now() + expirationMs),
        quoteId,
        io
      )
      io.console.info(quote)
      return quote
    }
  }

  return out
}

function makeTotleSwapPluginQuote (
  request: EdgeSwapRequest,
  fromNativeAmount: string,
  toNativeAmount: string,
  txs: Array<EdgeTransaction>,
  destinationAddress: string,
  pluginName: string,
  expirationDate?: Date,
  quoteId?: string,
  io
): EdgeSwapPluginQuote {
  io.console.info(arguments)
  const { fromWallet } = request
  const swapTx = txs[txs.length - 1]

  const out: EdgeSwapPluginQuote = {
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount: swapTx.networkFee
    },
    destinationAddress,
    pluginName,
    expirationDate,
    quoteId,

    async approve (): Promise<EdgeTransaction> {
      let swapTx = {}
      let index = 0
      for (const tx of txs) {
        const signedTransaction = await fromWallet.signTx(tx)
        // NOTE: The swap transaction will always be the last one
        swapTx = await fromWallet.broadcastTx(signedTransaction)
        const lastTransactionIndex = txs.length - 1
        // if it's the last transaction of the array then assign `nativeAmount` data
        // (after signing and broadcasting) for metadata purposes
        if (index === lastTransactionIndex) {
          tx.nativeAmount = `-${fromNativeAmount}`
        }
        await fromWallet.saveTx(signedTransaction)
        index++
      }
      if (!swapTx) throw new Error('No Totle swapTx')
      return swapTx
    },

    async close () {}
  }
  return out
}
