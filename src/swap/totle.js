// @flow

import { div, mul } from 'biggystring'
import {
  asArray,
  asBoolean,
  asEither,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeLog,
  type EdgeSpendInfo,
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

  orderUri: 'https://api.totle.com/swap',
  supportEmail: 'support@totle.com'
}

const swapUri = 'https://api.totle.com/swap'
const tokenUri = 'https://api.totle.com/tokens'
const expirationMs = 1000 * 60 * 20

const asTotleErrorResponse = asObject({
  success: asValue(false),
  response: asObject({
    id: asString,
    code: asNumber,
    message: asString,
    info: asString,
    name: asOptional(asString),
    link: asOptional(asString)
  })
})

const asTotleSwapResponse = asObject({
  success: asValue(true),
  response: asObject({
    summary: asArray(
      asObject({
        destinationAmount: asString,
        guaranteedRate: asString,
        sourceAmount: asString
      })
    ),
    transactions: asArray(
      asObject({
        type: asEither(asValue('swap'), asValue('approve')),
        tx: asObject({
          to: asString,
          from: asString,
          value: asString,
          data: asString,
          gasPrice: asString,
          gas: asString,
          nonce: asOptional(asNumber)
        })
      })
    )
  })
})

type TotleSwapResponse = $Call<typeof asTotleSwapResponse>

// /swap
const asTotleSwapReply = asEither(asTotleSwapResponse, asTotleErrorResponse)
type TotleSwapReply = $Call<typeof asTotleSwapReply>

// /tokens
const asToken = asObject({
  name: asString,
  symbol: asString,
  decimals: asNumber,
  address: asString,
  tradable: asBoolean,
  iconUrl: asString
})
type Token = $Call<typeof asToken>

const asTotleTokensResponse = asObject({
  tokens: asArray(asToken)
})

function checkSwapReply(
  reply: TotleSwapReply,
  request: EdgeSwapRequest
): TotleSwapResponse {
  // Handle error response
  if (reply.success === false) {
    const code = reply.response.code
    switch (code) {
      case 1203: // TokenNotFoundError
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      case 3100: // InsufficientFundsError
        throw new InsufficientFundsError()
      case 1201: // AmountError
        throw new NoAmountSpecifiedError()
      default:
        throw new Error(`Totle API Error: ${reply.response.message}`)
    }
  }

  // Return swap response
  return reply
}

export function makeTotlePlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { initOptions, io, log } = opts
  const { fetchCors = io.fetch } = io

  const { partnerContract, apiKey } = initOptions

  async function fetchSwapReply(json: any): Promise<TotleSwapReply> {
    const body = JSON.stringify({
      ...json,
      partnerContract,
      apiKey
    })

    log('fetchSwap:', json)
    const headers = {
      'Content-Type': 'application/json'
    }
    const response = await fetchCors(swapUri, { method: 'POST', body, headers })
    if (!response.ok) {
      throw new Error(`Totle returned error code ${response.status}`)
    }
    const responseBody = await response.json()
    const reply = asTotleSwapReply(responseBody)
    log('swap reply:', reply)
    return reply
  }

  async function fetchTokens(): Promise<Token[]> {
    const response = await fetchCors(tokenUri, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`Totle returned error code ${response.status}`)
    }
    const reply = asTotleTokensResponse(await response.json())
    const { tokens } = reply
    log('token reply:', tokens)
    return tokens
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapQuote> {
      const tokens: Token[] = await fetchTokens()

      const fromToken = tokens.find(t => t.symbol === request.fromCurrencyCode)
      const toToken = tokens.find(t => t.symbol === request.toCurrencyCode)
      if (!fromToken || !toToken || fromToken.symbol === toToken.symbol) {
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
      const reply = await fetchSwapReply({
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
      const swapResponse = checkSwapReply(reply, request)
      const { summary: summaries, transactions } = swapResponse.response
      const summary = summaries[0]

      let fromNativeAmount: string = summary.sourceAmount // string with many zeroes
      let toNativeAmount: string = summary.destinationAmount // string with many zeroes
      const fromMultiplier = '1' + '0'.repeat(fromToken.decimals)
      const toMultiplier = '1' + '0'.repeat(toToken.decimals)
      const isSourceRequest = request.quoteFor === 'from'
      if (isSourceRequest) {
        const fromExchangeAmount = div(fromNativeAmount, fromMultiplier, 10)
        const toExchangeAmount = mul(fromExchangeAmount, summary.guaranteedRate)
        toNativeAmount = mul(toExchangeAmount, toMultiplier)
      } else {
        const toExchangeAmount = div(toNativeAmount, toMultiplier, 10)
        const fromExchangeAmount = mul(toExchangeAmount, summary.guaranteedRate)
        fromNativeAmount = mul(fromExchangeAmount, fromMultiplier)
      }

      const txs = []
      for (const swapTansaction of transactions) {
        // Make the transaction:
        const spendInfo: EdgeSpendInfo = {
          currencyCode: request.fromCurrencyCode,
          spendTargets: [
            {
              nativeAmount: swapTansaction.tx.value,
              publicAddress: swapTansaction.tx.to,
              uniqueIdentifier: swapTansaction.id,
              otherParams: { data: swapTansaction.tx.data }
            }
          ],
          networkFeeOption: 'custom',
          customNetworkFee: {
            gasLimit: swapTansaction.tx.gas,
            gasPrice: String(parseInt(swapTansaction.tx.gasPrice) / 1000000000)
          },
          swapData: {
            isEstimate: false,
            payoutAddress: userToAddress,
            payoutCurrencyCode: request.toCurrencyCode,
            payoutNativeAmount: toNativeAmount,
            payoutWalletId: request.toWallet.id,
            plugin: { ...swapInfo }
          }
        }

        const edgeTransaction: EdgeTransaction = await request.fromWallet.makeSpend(
          spendInfo
        )

        txs.push(edgeTransaction)
      }

      const quote = makeTotleSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        txs,
        userToAddress,
        false,
        new Date(Date.now() + expirationMs),
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
  txs: EdgeTransaction[],
  destinationAddress: string,
  isEstimate: boolean,
  expirationDate?: Date,
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
      nativeAmount:
        swapTx.parentNetworkFee != null
          ? swapTx.parentNetworkFee
          : swapTx.networkFee
    },
    destinationAddress,
    pluginId,
    expirationDate,
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
        orderId: swapTx.txid
      }
    },

    async close() {}
  }
  return out
}
