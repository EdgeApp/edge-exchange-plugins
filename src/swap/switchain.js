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
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

// import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'switchain',
  pluginName: 'switchain',
  displayName: 'Switchain',
  quoteUri: 'https://www.switchain.com/transactions',
  supportEmail: 'help@switchain.com'
}

const apiUrl = 'https://api-testnet.switchain.com/rest/v1'

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
  toAddres: string,
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
  toAmount?: string
}

const dontUseLegacy = {
  DGB: true
}

export function makeSwitchainPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io, log } = opts

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
      // only way i found to circumvent Object.entries type errors
      const queryStringList: Array<[string, string]> = Object.entries(
        query
      ).map(([k, v]) => [k, String(v)])
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
    log('reply', replyJson)

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

  // closures to be populated between `fetchSwapQuote` and `approve`
  let fromCurrencyCode = ''
  let quoteForFrom = true
  let fromNativeAmount = 0
  let toNativeAmount = 0
  let orderCreationBody: SwitchainOrderCreationBody = {
    pair: '',
    toAddress: '',
    refundAddress: '',
    signature: ''
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      const {
        fromWallet,
        nativeAmount,
        quoteFor,
        toCurrencyCode,
        toWallet
      } = request

      fromCurrencyCode = request.fromCurrencyCode
      if (toCurrencyCode === fromCurrencyCode) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // convert TBTC to BTC for testing purposes
      if (fromCurrencyCode.toUpperCase() === 'TBTC') {
        fromCurrencyCode = 'BTC'
      }

      const pair = `${fromCurrencyCode.toUpperCase()}-${toCurrencyCode.toUpperCase()}`

      // get wallet addresses for exchange
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(fromWallet, fromCurrencyCode),
        getAddress(toWallet, toCurrencyCode)
      ])

      // Check for supported currencies, even if we aren't activated:
      const json: SwitchainOfferResponse = await swHttpCall(
        '/offer',
        'GET',
        null,
        {
          pair,
          orderIdSeed: toAddress
        }
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

      quoteForFrom = quoteFor === 'from'
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
      orderCreationBody = {
        pair,
        toAddress,
        refundAddress: fromAddress,
        signature,
        orderId,
        ...quoteAmount
      }

      // plugin output creation
      fromNativeAmount = nativeAmount
      toNativeAmount = await toWallet.denominationToNative(
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

      const destinationAddress = toAddress
      const expirationDate = new Date(expiryTs * 1000)
      const isEstimate = false

      // create preliminary tx using our recieve address to calculate a networkFee
      const spendInfo: EdgeSpendInfo = {
        currencyCode: fromCurrencyCode,
        spendTargets: [
          { nativeAmount: fromNativeAmount, publicAddress: fromAddress }
        ]
      }

      const preliminaryTx: EdgeTransaction = await fromWallet.makeSpend(
        spendInfo
      )

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        preliminaryTx,
        destinationAddress,
        swapInfo.pluginName,
        isEstimate,
        expirationDate,
        orderId
      )
    }
  }

  function makeSwapPluginQuote(
    request: EdgeSwapRequest,
    fromNativeAmount: string,
    toNativeAmount: string,
    tx: EdgeTransaction,
    destinationAddress: string,
    pluginId: string,
    isEstimate: boolean = false,
    expirationDate?: Date,
    quoteId?: string
  ): EdgeSwapPluginQuote {
    const { fromWallet } = request

    const out: EdgeSwapPluginQuote = {
      fromNativeAmount,
      toNativeAmount,
      networkFee: {
        currencyCode: fromWallet.currencyInfo.currencyCode,
        nativeAmount: tx.networkFee
      },
      destinationAddress,
      pluginName: swapInfo.pluginName,
      expirationDate,
      quoteId,
      isEstimate,
      async approve(): Promise<EdgeTransaction> {
        const json: SwitchainOrderCreationResponse = await swHttpCall(
          '/order',
          'POST',
          orderCreationBody
        )
        const { exchangeAddress, exchangeAddressTag } = json

        // create tx with response and send
        const spendTarget: EdgeSpendTarget = {
          nativeAmount: fromNativeAmount,
          publicAddress: exchangeAddress,
          otherParams: exchangeAddressTag
            ? { uniqueIdentifier: exchangeAddressTag }
            : {}
        }
        const spendInfo: EdgeSpendInfo = {
          currencyCode: fromCurrencyCode,
          spendTargets: [spendTarget]
        }
        const completeTx: EdgeTransaction = await fromWallet.makeSpend(
          spendInfo
        )

        const signedTransaction = await fromWallet.signTx(completeTx)
        const broadcastedTransaction = await fromWallet.broadcastTx(
          signedTransaction
        )
        await fromWallet.saveTx(signedTransaction)

        return broadcastedTransaction
      },

      async close() {}
    }
    return out
  }

  return out
}
