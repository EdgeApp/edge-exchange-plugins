import { gt, lt } from 'biggystring'
import {
  asDate,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  Cleaner
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  ensureInFuture,
  getCodesWithTranscription,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../swap-helpers'
import { convertRequest, getAddress, makeEdgeMemos } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'
const pluginId = 'changenow'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Change NOW',
  supportEmail: 'support@changenow.io'
}

const asInitOptions = asObject({
  apiKey: asString
})

const orderUri = 'https://changenow.io/exchange/txs/'
const uri = 'https://api.changenow.io/v2/'

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

// Network names that don't match parent network currency code
// See https://changenow.io/currencies for list of supported currencies
const MAINNET_CODE_TRANSCRIPTION = {
  binancesmartchain: 'BSC'
}

export function makeChangeNowPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'x-changenow-api-key': apiKey
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const { promoCode } = opts
    const { nativeAmount } = request

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet),
      getAddress(request.toWallet)
    ])

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodesWithTranscription(request, MAINNET_CODE_TRANSCRIPTION)
    const currencyString = `fromCurrency=${fromCurrencyCode}&toCurrency=${toCurrencyCode}&fromNetwork=${fromMainnetCode}&toNetwork=${toMainnetCode}`

    async function createOrder(
      flow: 'fixed-rate' | 'standard',
      isSelling: boolean,
      largeDenomAmount: string
    ): Promise<ChangeNowResponse> {
      const type = isSelling ? 'direct' : 'reverse'

      // Get rateId and Date
      const url = `exchange/estimated-amount?flow=${flow}&useRateId=${String(
        flow === 'fixed-rate'
      )}&${
        isSelling ? 'fromAmount' : 'toAmount'
      }=${largeDenomAmount}&type=${type}&${currencyString}`
      const exchangeAmountResponse = await fetchCors(uri + url, { headers })
      const exchangeAmountResponseJson = await exchangeAmountResponse.json()

      if (exchangeAmountResponseJson.error != null)
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)

      const { rateId, validUntil } = asExchange(exchangeAmountResponseJson)

      // Create order
      const orderBody = {
        fromCurrency: fromCurrencyCode,
        toCurrency: toCurrencyCode,
        fromNetwork: fromMainnetCode,
        toNetwork: toMainnetCode,
        fromAmount: isSelling ? largeDenomAmount : '',
        toAmount: isSelling ? '' : largeDenomAmount,
        type,
        address: toAddress,
        refundAddress: fromAddress,
        flow,
        rateId,
        payload: { promoCode }
      }

      const orderResponse = await fetchCors(uri + 'exchange', {
        method: 'POST',
        body: JSON.stringify(orderBody),
        headers
      })
      if (!orderResponse.ok) {
        const text = await orderResponse.text()
        throw new Error(
          `ChangeNow call returned error code ${orderResponse.status}, ${text}`
        )
      }
      const orderResponseJson = await orderResponse.json()

      return { ...asOrder(orderResponseJson), validUntil }
    }

    async function swapSell(
      flow: 'fixed-rate' | 'standard'
    ): Promise<SwapOrder> {
      const largeDenomAmount = await request.fromWallet.nativeToDenomination(
        nativeAmount,
        fromCurrencyCode
      )

      // Get min and max
      const marketRangeResponse = await fetchCors(
        uri + `exchange/range?flow=${flow}&${currencyString}`,
        { headers }
      )
      const marketRangeResponseJson = await marketRangeResponse.json()

      if (marketRangeResponseJson.error != null)
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)

      const { minAmount, maxAmount } = asMarketRange(marketRangeResponseJson)

      if (lt(largeDenomAmount, minAmount.toString())) {
        const minNativeAmount = await request.fromWallet.denominationToNative(
          minAmount.toString(),
          fromCurrencyCode
        )
        throw new SwapBelowLimitError(swapInfo, minNativeAmount)
      }

      if (maxAmount != null && gt(largeDenomAmount, maxAmount.toString())) {
        const maxNativeAmount = await request.fromWallet.denominationToNative(
          maxAmount.toString(),
          fromCurrencyCode
        )
        throw new SwapAboveLimitError(swapInfo, maxNativeAmount)
      }

      const {
        toAmount,
        payinAddress,
        payinExtraId,
        id,
        validUntil
      } = await createOrder(flow, true, largeDenomAmount)

      const toNativeAmount = await request.toWallet.denominationToNative(
        toAmount.toString(),
        toCurrencyCode
      )

      const spendInfo: EdgeSpendInfo = {
        currencyCode: fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount,
            publicAddress: payinAddress
          }
        ],
        memos: makeEdgeMemos(request.fromWallet.currencyInfo, payinExtraId),
        networkFeeOption: fromCurrencyCode === 'BTC' ? 'high' : 'standard',
        swapData: {
          orderId: id,
          orderUri: orderUri + id,
          isEstimate: flow === 'standard',
          payoutAddress: toAddress,
          payoutCurrencyCode: toCurrencyCode,
          payoutNativeAmount: toNativeAmount,
          payoutWalletId: request.toWallet.id,
          plugin: { ...swapInfo },
          refundAddress: fromAddress
        }
      }

      return {
        request,
        spendInfo,
        swapInfo,
        fromNativeAmount: nativeAmount,
        expirationDate:
          validUntil != null
            ? ensureInFuture(validUntil)
            : new Date(Date.now() + 1000 * 60)
      }
    }

    async function swapBuy(flow: 'fixed-rate'): Promise<SwapOrder> {
      // Skip min/max check when requesting a purchase amount
      const largeDenomAmount = await request.toWallet.nativeToDenomination(
        nativeAmount,
        toCurrencyCode
      )

      const {
        fromAmount,
        payinAddress,
        payinExtraId,
        id,
        validUntil
      } = await createOrder(flow, false, largeDenomAmount)

      const fromNativeAmount = await request.fromWallet.denominationToNative(
        fromAmount.toString(),
        fromCurrencyCode
      )

      const spendInfo: EdgeSpendInfo = {
        currencyCode: fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: payinAddress
          }
        ],
        memos: makeEdgeMemos(request.fromWallet.currencyInfo, payinExtraId),
        networkFeeOption: fromCurrencyCode === 'BTC' ? 'high' : 'standard',
        swapData: {
          orderId: id,
          orderUri: orderUri + id,
          isEstimate: false,
          payoutAddress: toAddress,
          payoutCurrencyCode: toCurrencyCode,
          payoutNativeAmount: nativeAmount,
          payoutWalletId: request.toWallet.id,
          plugin: { ...swapInfo },
          refundAddress: fromAddress
        }
      }

      return {
        request,
        spendInfo,
        swapInfo,
        fromNativeAmount,
        expirationDate:
          validUntil != null
            ? ensureInFuture(validUntil)
            : new Date(Date.now() + 1000 * 60)
      }
    }

    const { quoteFor } = request

    // Try them all
    if (quoteFor === 'from') {
      try {
        return await swapSell('fixed-rate')
      } catch (e) {
        try {
          return await swapSell('standard')
        } catch (e2) {
          // Should throw the fixed-rate error
          throw e
        }
      }
    } else {
      return await swapBuy('fixed-rate')
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      const newRequest = await getMaxSwappable(
        fetchSwapQuoteInner,
        request,
        opts
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest, opts)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

/**
 * An optional value, where a blank string means undefined.
 */
export function asOptionalBlank<T>(
  cleaner: (raw: any) => T
): Cleaner<T | undefined> {
  return function asIgnoredBlank(raw) {
    if (raw == null || raw === '') return
    return cleaner(raw)
  }
}

const asMarketRange = asObject({
  maxAmount: asMaybe(asNumber),
  minAmount: asNumber
})

const asExchange = asObject({
  rateId: asOptional(asString),
  validUntil: asOptional(asDate)
})

const asOrder = asObject({
  fromAmount: asNumber,
  toAmount: asNumber,
  payinAddress: asString,
  payinExtraId: asOptionalBlank(asString),
  id: asString
})

type ChangeNowResponse = ReturnType<typeof asOrder> & { validUntil?: Date }
