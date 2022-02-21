// @flow

import { gt, lt } from 'biggystring'
import {
  type Cleaner,
  asDate,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  type InvalidCurrencyCodes,
  checkInvalidCodes,
  ensureInFuture,
  getCodes,
  makeSwapPluginQuote
} from '../swap-helpers.js'

const pluginId = 'changenow'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Change NOW',
  supportEmail: 'support@changenow.io'
}

const orderUri = 'https://changenow.io/exchange/txs/'
const uri = 'https://api.changenow.io/v2/'

const dontUseLegacy = {
  DGB: true
}

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
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

export function makeChangeNowPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const { fetch } = io

  if (initOptions.apiKey == null) {
    throw new Error('No ChangeNow apiKey provided.')
  }
  const { apiKey } = initOptions

  const headers = {
    'Content-Type': 'application/json',
    'x-changenow-api-key': apiKey
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const { promoCode } = opts

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(request.fromWallet, request.fromCurrencyCode),
        getAddress(request.toWallet, request.toCurrencyCode)
      ])

      const {
        fromCurrencyCode,
        toCurrencyCode,
        fromMainnetCode,
        toMainnetCode
      } = getCodes(request)
      const currencyString = `fromCurrency=${fromCurrencyCode}&toCurrency=${toCurrencyCode}&fromNetwork=${fromMainnetCode}&toNetwork=${toMainnetCode}`

      const { nativeAmount, quoteFor } = request

      async function createOrder(
        flow: 'fixed-rate' | 'standard',
        isSelling: boolean,
        largeDenomAmount: string
      ): Promise<ChangeNowResponse> {
        const type = isSelling ? 'direct' : 'reverse'

        // Get rateId and Date
        const exchangeAmountResponse = await fetch(
          uri +
            `exchange/estimated-amount?flow=${flow}&useRateId=${String(
              flow === 'fixed-rate'
            )}&${
              isSelling ? 'fromAmount' : 'toAmount'
            }=${largeDenomAmount}&type=${type}&${currencyString}`,
          { headers }
        )
        const exchangeAmountResponseJson = await exchangeAmountResponse.json()

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

        const orderResponse = await fetch(uri + 'exchange', {
          method: 'POST',
          body: JSON.stringify(orderBody),
          headers
        })
        if (!orderResponse.ok) {
          throw new Error(
            `ChangeNow call returned error code ${orderResponse.status}`
          )
        }
        const orderResponseJson = await orderResponse.json()

        return { ...asOrder(orderResponseJson), validUntil }
      }

      async function swapSell(
        flow: 'fixed-rate' | 'standard'
      ): Promise<EdgeSwapQuote> {
        const largeDenomAmount = await request.fromWallet.nativeToDenomination(
          nativeAmount,
          fromCurrencyCode
        )

        // Get min and max
        const marketRangeResponse = await fetch(
          uri + `exchange/range?flow=${flow}&${currencyString}`,
          { headers }
        )
        const marketRangeResponseJson = await marketRangeResponse.json()

        if (marketRangeResponseJson.error != null)
          throw new SwapCurrencyError(
            swapInfo,
            fromCurrencyCode,
            toCurrencyCode
          )

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
              publicAddress: payinAddress,
              uniqueIdentifier: payinExtraId
            }
          ],
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
        const tx: EdgeTransaction = await request.fromWallet.makeSpend(
          spendInfo
        )
        return makeSwapPluginQuote(
          request,
          nativeAmount,
          toNativeAmount,
          tx,
          toAddress,
          pluginId,
          flow === 'standard',
          validUntil != null
            ? ensureInFuture(validUntil)
            : new Date(Date.now() + 1000 * 60 * 20),
          id
        )
      }

      async function swapBuy(flow: 'fixed-rate'): Promise<EdgeSwapQuote> {
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
              publicAddress: payinAddress,
              uniqueIdentifier: payinExtraId
            }
          ],
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

        const tx: EdgeTransaction = await request.fromWallet.makeSpend(
          spendInfo
        )
        return makeSwapPluginQuote(
          request,
          fromNativeAmount,
          nativeAmount,
          tx,
          toAddress,
          pluginId,
          false,
          validUntil != null
            ? ensureInFuture(validUntil)
            : new Date(Date.now() + 1000 * 60 * 20),
          id
        )
      }

      // Try them all
      if (quoteFor === 'from') {
        try {
          return swapSell('fixed-rate')
        } catch (e) {
          try {
            return swapSell('standard')
          } catch (e2) {
            // Should throw the fixed-rate error
            throw e
          }
        }
      } else {
        return swapBuy('fixed-rate')
      }
    }
  }
  return out
}

/**
 * An optional value, where a blank string means undefined.
 */
export function asOptionalBlank<T>(
  cleaner: (raw: any) => T
): Cleaner<T | void> {
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

type ChangeNowResponse = $Call<typeof asOrder> & { validUntil?: Date }
