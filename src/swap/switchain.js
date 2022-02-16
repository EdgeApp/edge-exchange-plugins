// @flow

import { add, div, gt, lt, mul, sub } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeFetchResponse,
  type EdgeSpendInfo,
  type EdgeSpendTarget,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeSwapResult,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { type InvalidCurrencyCodes, checkInvalidCodes } from '../swap-helpers'

const pluginId = 'switchain'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Switchain',
  supportEmail: 'help@switchain.com'
}

let apiUrl = 'https://api.switchain.com/rest/v1'
const orderUri = 'https://www.switchain.com/order-status/'

type SwitchainResponseError = {
  error: string,
  reason?: string
}

type SwitchainOfferResponse = {
  pair: string,
  signature: string,
  quote: string,
  maxLimit: string,
  minLimit: string,
  expiryTs: number,
  minerFee: string,
  orderId?: string
}

type SwitchainOrderCreationResponse = {
  orderId: string,
  fromAmount: string,
  rate: string,
  exchangeAddress: string,
  exchangeAddressTag?: string,
  refundAddress: string,
  refundAddressTag?: string,
  toAddress: string,
  toAddressTag?: string
}

type SwitchainOrderCreationBody = {
  pair: string,
  toAddress: string,
  toAddressTag?: string,
  refundAddress: string,
  refundAddressTag?: string,
  signature: string,
  fromAmount?: string,
  toAmount?: string,
  promotionCode?: string
}

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    ETH: ['MATIC'],
    AVAX: 'allTokens',
    CELO: 'allTokens',
    FTM: 'allCodes',
    MATIC: 'allCodes'
  },
  to: {
    ETH: ['MATIC'],
    AVAX: 'allTokens',
    CELO: 'allTokens',
    FTM: 'allCodes',
    MATIC: 'allCodes',
    ZEC: ['ZEC']
  }
}

const dontUseLegacy = {
  DGB: true,
  LTC: true
}

const dummyAddresses = {
  ETH: '0x0000000000000000000000000000000000000000',
  XRP: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
  XLM: 'GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A',
  BNB: 'bnb136ns6lfw4zs5hg4n85vdthaad7hq5m4gtkgf23',
  XTZ: 'tz1dD2rBsYYLnsZtijtGqT4tynCEVaEJ6DeL',
  EOS: 'binancecleos'
}

export function makeSwitchainPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts

  if (!initOptions.apiKey) {
    throw new Error('No Switchain API key provided.')
  }

  async function getAddress(
    wallet: EdgeCurrencyWallet,
    currencyCode: string
  ): Promise<string> {
    const addressInfo = await wallet.getReceiveAddress({ currencyCode })

    return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
      ? addressInfo.legacyAddress
      : addressInfo.publicAddress
  }

  async function swHttpCall(
    path: string,
    method: string,
    body?: Object,
    query?: { [string]: string }
  ) {
    let requestOpts = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initOptions.apiKey}`
      },
      method
    }

    if (body) {
      requestOpts = { ...requestOpts, body: JSON.stringify(body) }
    }
    let queryParams = ''
    if (query) {
      const queryStringList: Array<[string, string]> = []
      for (const k of Object.keys(query)) {
        queryStringList.push([k, query[k]])
      }
      queryParams = `?${new URLSearchParams(queryStringList).toString()}`
    }
    const uri = `${apiUrl}${path}${queryParams}`
    const reply: EdgeFetchResponse = await io.fetch(uri, requestOpts)

    let replyJson:
      | SwitchainOfferResponse
      | SwitchainOrderCreationResponse
      | SwitchainResponseError
    try {
      replyJson = await reply.json()
    } catch (e) {
      throw new Error(
        `Switchain ${uri} returned error code ${reply.status} (no JSON)`
      )
    }

    if (reply.status !== 200) {
      if (replyJson.reason) {
        throw new Error(replyJson.reason)
      }

      throw new Error(
        `Switchain ${uri} returned error code ${
          replyJson.status
        } with JSON ${JSON.stringify(replyJson)}`
      )
    }

    return replyJson
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const {
        fromWallet,
        nativeAmount,
        quoteFor,
        toCurrencyCode,
        toWallet
      } = request
      let { fromCurrencyCode } = request
      const { promoCode } = opts

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      if (toCurrencyCode === fromCurrencyCode) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // convert TBTC to BTC for testing purposes
      if (fromCurrencyCode.toUpperCase() === 'TESTBTC') {
        fromCurrencyCode = 'BTC'
        apiUrl = 'https://api-testnet.switchain.com/rest/v1'
      } else {
        apiUrl = 'https://api.switchain.com/rest/v1'
      }

      const pair = `${fromCurrencyCode.toUpperCase()}-${toCurrencyCode.toUpperCase()}`

      // get wallet addresses for exchange
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(fromWallet, fromCurrencyCode),
        getAddress(toWallet, toCurrencyCode)
      ])

      // retrieve quote for pair
      const queryParameters: { [string]: string } = {
        pair,
        orderIdSeed: toAddress
      }
      if (promoCode != null) queryParameters.promotionCode = promoCode
      const json: SwitchainOfferResponse = await swHttpCall(
        '/offer',
        'GET',
        null,
        queryParameters
      )
      const {
        maxLimit,
        minLimit,
        minerFee,
        quote,
        signature,
        expiryTs,
        orderId
      } = json

      // get native min max limits
      const [nativeMax, nativeMin] = await Promise.all([
        fromWallet.denominationToNative(maxLimit.toString(), fromCurrencyCode),
        fromWallet.denominationToNative(minLimit.toString(), fromCurrencyCode)
      ])

      // determine amount param for order creation
      const [fromAmount, toAmount] = await Promise.all([
        fromWallet.nativeToDenomination(nativeAmount, fromCurrencyCode),
        toWallet.nativeToDenomination(nativeAmount, toCurrencyCode)
      ])

      const quoteForFrom = quoteFor === 'from'
      // check for min / max limits
      if (quoteForFrom) {
        if (lt(nativeAmount, nativeMin)) {
          throw new SwapBelowLimitError(swapInfo, nativeMin)
        }
        if (gt(nativeAmount, nativeMax)) {
          throw new SwapAboveLimitError(swapInfo, nativeMax)
        }
      } else {
        const toAmountInFrom = div(toAmount, quote, 8)

        if (lt(toAmountInFrom, minLimit)) {
          throw new SwapBelowLimitError(swapInfo, nativeMin)
        }

        if (gt(toAmountInFrom, maxLimit)) {
          throw new SwapAboveLimitError(swapInfo, nativeMax)
        }
      }

      // order creation body
      const quoteAmount = quoteForFrom ? { fromAmount } : { toAmount }

      const orderCreationBody: SwitchainOrderCreationBody = {
        pair,
        toAddress,
        refundAddress: fromAddress,
        signature,
        orderId,
        ...quoteAmount
      }
      if (promoCode != null) orderCreationBody.promotionCode = promoCode

      // plugin output creation
      let fromNativeAmount = nativeAmount
      let toNativeAmount = await toWallet.denominationToNative(
        sub(mul(quote, fromAmount), minerFee),
        toCurrencyCode
      )
      if (!quoteForFrom) {
        fromNativeAmount = await fromWallet.denominationToNative(
          div(add(toAmount, minerFee), quote, 8),
          fromCurrencyCode
        )
        toNativeAmount = nativeAmount
      }

      const expirationDate = new Date(expiryTs * 1000)

      // create preliminary tx using our recieve address to calculate a networkFee
      const spendInfo: EdgeSpendInfo = {
        currencyCode: fromCurrencyCode,
        networkFeeOption:
          fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress:
              dummyAddresses[fromWallet.currencyInfo.currencyCode] ||
              fromAddress
          }
        ]
      }

      const preliminaryTx: EdgeTransaction = await fromWallet.makeSpend(
        spendInfo
      )

      // convert that to the output format:
      const out: EdgeSwapQuote = {
        isEstimate: false,
        fromNativeAmount,
        toNativeAmount,
        networkFee: {
          currencyCode: fromWallet.currencyInfo.currencyCode,
          nativeAmount:
            preliminaryTx.parentNetworkFee != null
              ? preliminaryTx.parentNetworkFee
              : preliminaryTx.networkFee
        },
        expirationDate,
        pluginId,
        async approve(): Promise<EdgeSwapResult> {
          const json: SwitchainOrderCreationResponse = await swHttpCall(
            '/order',
            'POST',
            orderCreationBody
          )
          const { orderId, exchangeAddress, exchangeAddressTag } = json

          // create tx with response and send
          const spendTarget: EdgeSpendTarget = {
            nativeAmount: fromNativeAmount,
            publicAddress: exchangeAddress,
            uniqueIdentifier: exchangeAddressTag
          }
          const spendInfo: EdgeSpendInfo = {
            currencyCode: fromCurrencyCode,
            spendTargets: [spendTarget],
            networkFeeOption:
              fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
            swapData: {
              orderId,
              orderUri: orderUri + orderId,
              isEstimate: false,
              payoutAddress: toAddress,
              payoutCurrencyCode: request.toCurrencyCode,
              payoutNativeAmount: toNativeAmount,
              payoutWalletId: request.toWallet.id,
              plugin: { ...swapInfo },
              refundAddress: fromAddress
            }
          }
          const completeTx: EdgeTransaction = await fromWallet.makeSpend(
            spendInfo
          )

          const signedTransaction = await fromWallet.signTx(completeTx)
          const broadcastedTransaction = await fromWallet.broadcastTx(
            signedTransaction
          )
          await fromWallet.saveTx(signedTransaction)

          return {
            transaction: broadcastedTransaction,
            destinationAddress: exchangeAddress,
            orderId
          }
        },

        async close() {}
      }
      return out
    }
  }

  return out
}
