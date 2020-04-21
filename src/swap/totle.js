// @flow

import { div, mul } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeLog,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeSwapResult,
  type EdgeTransaction,
  InsufficientFundsError,
  NoAmountSpecifiedError,
  SwapCurrencyError
} from 'edge-core-js/types'

const pluginId = 'totle'
const swapInfo: EdgeSwapInfo = {
  pluginId,
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
    guaranteedRate: string,
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

type Token = {
  name: string,
  symbol: string,
  decimals: number,
  address: string,
  tradable: boolean,
  iconUrl: string
}

function checkReply(reply: Object, request: EdgeSwapRequest) {
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

export function makeTotlePlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { initOptions, io, log } = opts
  const { fetchCors = io.fetch } = io

  const { partnerContract, apiKey } = initOptions

  async function call(json: any) {
    const body = JSON.stringify({
      ...json,
      partnerContract,
      apiKey
    })

    log('call:', json)
    const headers = {
      'Content-Type': 'application/json'
    }
    const response = await fetchCors(swapUri, { method: 'POST', body, headers })
    if (!response.ok) {
      throw new Error(`Totle returned error code ${response.status}`)
    }
    const out = await response.json()
    log('swap reply:', out)
    return out
  }

  async function fetchTokens() {
    const response = await fetchCors(tokenUri, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`Totle returned error code ${response.status}`)
    }
    const json = await response.json()
    const out = json.tokens
    log('token reply:', out)
    return out
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapQuote> {
      const tokens: Array<Token> = await fetchTokens()

      const fromToken = tokens.find(t => t.symbol === request.fromCurrencyCode)
      const toToken = tokens.find(t => t.symbol === request.toCurrencyCode)
      if (!fromToken || !toToken) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
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
        config: {
          transactions: true
        },
        swap: {
          sourceAsset: fromToken.address,
          destinationAsset: toToken.address,
          [request.quoteFor === 'from'
            ? 'sourceAmount'
            : 'destinationAmount']: request.nativeAmount,
          // strictDestination: request.quoteFor === 'to',
          destinationAddress: userToAddress
        }
      })
      checkReply(reply, request)

      const { summary, transactions }: QuoteInfo = reply.response

      let fromNativeAmount: string = summary[0].sourceAmount // string with many zeroes
      let toNativeAmount: string = summary[0].destinationAmount // string with many zeroes
      const fromMultiplier = '1' + '0'.repeat(fromToken.decimals)
      const toMultiplier = '1' + '0'.repeat(toToken.decimals)
      const isSourceRequest = request.quoteFor === 'from'
      if (isSourceRequest) {
        const fromExchangeAmount = div(fromNativeAmount, fromMultiplier, 10)
        const toExchangeAmount = mul(
          fromExchangeAmount,
          summary[0].guaranteedRate
        )
        toNativeAmount = mul(toExchangeAmount, toMultiplier)
      } else {
        const toExchangeAmount = div(toNativeAmount, toMultiplier, 10)
        const fromExchangeAmount = mul(
          toExchangeAmount,
          summary[0].guaranteedRate
        )
        fromNativeAmount = mul(fromExchangeAmount, fromMultiplier)
      }

      const txs = []
      let quoteId
      for (const tx of transactions) {
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
        false,
        new Date(Date.now() + expirationMs),
        quoteId,
        log
      )
      log(quote)
      return quote
    }
  }

  return out
}

function makeTotleSwapPluginQuote(
  request: EdgeSwapRequest,
  fromNativeAmount: string,
  toNativeAmount: string,
  txs: Array<EdgeTransaction>,
  destinationAddress: string,
  isEstimate: boolean,
  expirationDate?: Date,
  quoteId?: string,
  log: EdgeLog
): EdgeSwapQuote {
  log(arguments)
  const { fromWallet } = request
  const swapTx = txs[txs.length - 1]

  const out: EdgeSwapQuote = {
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount: swapTx.networkFee
    },
    destinationAddress,
    pluginId,
    expirationDate,
    quoteId,
    isEstimate,

    async approve(): Promise<EdgeSwapResult> {
      let swapTx
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
      return {
        transaction: swapTx,
        destinationAddress,
        orderId: pluginId
      }
    },

    async close() {}
  }
  return out
}
