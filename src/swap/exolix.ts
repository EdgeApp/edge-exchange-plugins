import { lt } from 'biggystring'
import {
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  getCodesWithTranscription,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../swap-helpers'
import { convertRequest, getAddress } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'

const pluginId = 'exolix'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Exolix',
  supportEmail: 'support@exolix.com'
}

const asInitOptions = asObject({
  apiKey: asString
})

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    binancesmartchain: 'allCodes',
    ethereum: ['MATIC'],
    optimism: 'allCodes',
    polygon: 'allCodes'
  },
  to: {
    binancesmartchain: 'allCodes',
    ethereum: ['MATIC'],
    optimism: 'allCodes',
    polygon: 'allCodes',
    zcash: ['ZEC']
  }
}

// See https://exolix.com/currencies for list of supported currencies
const MAINNET_CODE_TRANSCRIPTION = {}

const orderUri = 'https://exolix.com/transaction/'
const uri = 'https://exolix.com/api/v2/'

const expirationMs = 1000 * 60

const asRateResponse = asObject({
  minAmount: asNumber,
  fromAmount: asNumber,
  toAmount: asNumber,
  message: asEither(asString, asNull)
})

const asQuoteInfo = asObject({
  id: asString,
  amount: asNumber,
  amountTo: asNumber,
  depositAddress: asString,
  depositExtraId: asOptional(asString)
})

export function makeExolixPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  async function call(
    method: 'GET' | 'POST',
    route: string,
    params: any
  ): Promise<Object> {
    const headers: { [header: string]: string } = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `${apiKey}`
    }

    let response: Awaited<ReturnType<typeof fetchCors>>

    if (method === 'POST') {
      const body = JSON.stringify(params)
      response = await fetchCors(uri + route, {
        method,
        headers,
        body
      })
    } else {
      const url = `${uri}${route}?${new URLSearchParams(params)}`
      response = await fetchCors(url, {
        method,
        headers
      })
    }

    if (!response.ok) {
      if (response.status === 422) {
        throw new SwapCurrencyError(swapInfo, params.coinFrom, params.coinTo)
      }
      throw new Error(`Exolix returned error code ${response.status}`)
    }

    return await response.json()
  }

  const getFixedQuote = async (
    request: EdgeSwapRequestPlugin,
    _userSettings: Object | undefined
  ): Promise<SwapOrder> => {
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet),
      getAddress(request.toWallet)
    ])

    const exchangeQuoteAmount =
      request.quoteFor === 'from'
        ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            request.fromCurrencyCode
          )
        : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            request.toCurrencyCode
          )

    const quoteAmount = parseFloat(exchangeQuoteAmount)

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodesWithTranscription(request, MAINNET_CODE_TRANSCRIPTION)

    const quoteParams: Record<string, any> = {
      coinFrom: fromCurrencyCode,
      coinFromNetwork: fromMainnetCode,
      coinTo: toCurrencyCode,
      coinToNetwork: toMainnetCode,
      amount: quoteAmount,
      rateType: 'fixed'
    }

    // Set the withdrawal amount if we are quoting for the toCurrencyCode
    if (request.quoteFor === 'to') {
      quoteParams.withdrawalAmount = quoteAmount
    }

    // Get Rate
    const rateResponse = asRateResponse(await call('GET', 'rate', quoteParams))

    if (rateResponse.message != null) {
      if (rateResponse.fromAmount < rateResponse.minAmount) {
        if (request.quoteFor === 'from') {
          const nativeMin = await request.fromWallet.denominationToNative(
            rateResponse.minAmount.toString(),
            request.fromCurrencyCode
          )
          throw new SwapBelowLimitError(swapInfo, nativeMin)
        } else {
          const withdrawMin =
            rateResponse.minAmount *
            (rateResponse.toAmount / rateResponse.fromAmount)

          const nativeMin = await request.toWallet.denominationToNative(
            withdrawMin.toFixed(8),
            request.toCurrencyCode
          )
          throw new SwapBelowLimitError(swapInfo, nativeMin, 'to')
        }
      }

      throw new Error(rateResponse.message)
    }

    // Check rate minimum:
    if (request.quoteFor === 'from') {
      const nativeMin = await request.fromWallet.denominationToNative(
        rateResponse.minAmount.toString(),
        request.fromCurrencyCode
      )

      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }
    } else {
      const nativeMin = await request.toWallet.denominationToNative(
        rateResponse.minAmount.toString(),
        request.toCurrencyCode
      )

      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin, 'to')
      }
    }

    // Make the transaction:
    const exchangeParams: Record<string, any> = {
      coinFrom: quoteParams.coinFrom,
      networkFrom: quoteParams.coinFromNetwork,
      coinTo: quoteParams.coinTo,
      networkTo: quoteParams.coinToNetwork,
      amount: quoteAmount,
      withdrawalAddress: toAddress,
      withdrawalExtraId: '',
      refundAddress: fromAddress,
      refundExtraId: '',
      rateType: 'fixed'
    }

    // Set the withdrawal amount if we are quoting for the toCurrencyCode
    if (request.quoteFor === 'to') {
      exchangeParams.withdrawalAmount = quoteAmount
    }

    const callJson = await call('POST', 'transactions', exchangeParams)
    const quoteInfo = asQuoteInfo(callJson)

    const fromNativeAmount = await request.fromWallet.denominationToNative(
      quoteInfo.amount.toString(),
      request.fromCurrencyCode
    )

    const toNativeAmount = await request.toWallet.denominationToNative(
      quoteInfo.amountTo.toString(),
      request.toCurrencyCode
    )

    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteInfo.depositAddress,
          uniqueIdentifier: quoteInfo.depositExtraId
        }
      ],
      networkFeeOption:
        request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
      swapData: {
        orderId: quoteInfo.id,
        orderUri: orderUri + quoteInfo.id,
        isEstimate: false,
        payoutAddress: toAddress,
        payoutCurrencyCode: request.toCurrencyCode,
        payoutNativeAmount: toNativeAmount,
        payoutWalletId: request.toWallet.id,
        plugin: {
          ...swapInfo
        },
        refundAddress: fromAddress
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: new Date(Date.now() + expirationMs)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      const newRequest = await getMaxSwappable(
        getFixedQuote,
        request,
        userSettings
      )
      const fixedOrder = await getFixedQuote(newRequest, userSettings)
      const fixedResult = await makeSwapPluginQuote(fixedOrder)

      return fixedResult
    }
  }

  return out
}
