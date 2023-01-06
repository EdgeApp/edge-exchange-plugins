import { add, gt, gte, mul, sub } from 'biggystring'
import {
  asDate,
  asMaybe,
  asNumber,
  asObject,
  asString,
  Cleaner
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
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
  ensureInFuture,
  getCodesWithTranscription,
  InvalidCurrencyCodes,
  isLikeKind,
  makeSwapPluginQuote,
  SwapOrder
} from '../swap-helpers'
import { div18 } from '../util/biggystringplus'
import { convertRequest } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'

const pluginId = 'swapuz'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Swapuz',
  supportEmail: 'support@swapuz.com'
}

const asInitOptions = asObject({
  apiKey: asString
})

const orderUri = 'https://swapuz.com/order/'
const uri = 'https://api.swapuz.com/api/home/v1/'

const dontUseLegacy: { [cc: string]: boolean } = {
  DGB: true
}

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

// Network names that don't match parent network currency code
const MAINNET_CODE_TRANSCRIPTION = {
  binancesmartchain: 'BSC'
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress != null && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeSwapuzPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io } = opts
  const fetch = io.fetchCors ?? io.fetch
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'api-key': apiKey
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<EdgeSwapQuote> => {
    const { fromWallet, toWallet } = request

    checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet, request.fromCurrencyCode),
      getAddress(toWallet, request.toCurrencyCode)
    ])

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodesWithTranscription(request, MAINNET_CODE_TRANSCRIPTION)

    const getQuote = async (mode: 'fix' | 'float'): Promise<SwapOrder> => {
      const { nativeAmount } = request

      const largeDenomAmount = await fromWallet.nativeToDenomination(
        nativeAmount,
        fromCurrencyCode
      )

      const getRateResponse = await fetch(
        uri +
          `rate/?mode=${mode}&amount=${largeDenomAmount}&from=${fromCurrencyCode}&to=${toCurrencyCode}&fromNetwork=${fromMainnetCode}&toNetwork=${toMainnetCode}`,
        { headers }
      )
      if (!getRateResponse.ok) {
        throw new Error(
          `Swapuz call returned error code ${getRateResponse.status}`
        )
      }

      const getRateJson = asApiResponse(asGetRate)(await getRateResponse.json())

      if (getRateJson.result == null)
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)

      const { minAmount } = getRateJson.result

      if (gt(minAmount.toString(), largeDenomAmount)) {
        const nativeMinAmount = await fromWallet.denominationToNative(
          minAmount.toString(),
          fromCurrencyCode
        )
        throw new SwapBelowLimitError(swapInfo, nativeMinAmount)
      }

      // Create order
      const orderBody = {
        from: fromCurrencyCode,
        fromNetwork: fromMainnetCode,
        to: toCurrencyCode,
        toNetwork: toMainnetCode,
        address: toAddress,
        amount: parseFloat(largeDenomAmount),
        mode,
        addressUserFrom: fromAddress,
        addressRefound: fromAddress
      }

      const createOrderResponse = await fetch(uri + 'order', {
        method: 'POST',
        body: JSON.stringify(orderBody),
        headers
      })
      if (!createOrderResponse.ok) {
        throw new Error(
          `Swapuz call returned error code ${createOrderResponse.status}`
        )
      }

      const createOrderJson = asApiResponse(asCreateOrder)(
        await createOrderResponse.json()
      )

      if (createOrderJson.result == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      const {
        addressFrom,
        finishPayment,
        amountResult,
        uid,
        memoFrom
      } = createOrderJson.result

      const toNativeAmount = await toWallet.denominationToNative(
        amountResult.toString(),
        toCurrencyCode
      )

      const spendInfo: EdgeSpendInfo = {
        currencyCode: fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: request.nativeAmount,
            publicAddress: addressFrom,
            uniqueIdentifier: memoFrom
          }
        ],
        networkFeeOption: fromCurrencyCode === 'BTC' ? 'high' : 'standard',
        swapData: {
          orderId: uid,
          orderUri: orderUri + uid,
          isEstimate: mode === 'float',
          payoutAddress: toAddress,
          payoutCurrencyCode: toCurrencyCode,
          payoutNativeAmount: toNativeAmount,
          payoutWalletId: request.toWallet.id,
          plugin: { ...swapInfo },
          refundAddress: fromAddress
        }
      }

      const order = {
        request,
        spendInfo,
        pluginId,
        expirationDate: ensureInFuture(finishPayment)
      }

      return order
    }

    // Try them all
    try {
      const swapOrder = await getQuote('fix')
      return await makeSwapPluginQuote(swapOrder)
    } catch (e) {
      try {
        const swapOrder = await getQuote('float')
        return await makeSwapPluginQuote(swapOrder)
      } catch (e2) {
        // Should throw the fixed-rate error
        throw e
      }
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const requestTop = convertRequest(req)
      const {
        fromCurrencyCode,
        toWallet,
        toCurrencyCode,
        nativeAmount,
        quoteFor
      } = requestTop

      if (quoteFor === 'from') {
        return await fetchSwapQuoteInner(requestTop)
      } else {
        // Exit early if trade isn't like kind assets
        if (!isLikeKind(fromCurrencyCode, toCurrencyCode)) {
          throw new SwapCurrencyError(
            swapInfo,
            fromCurrencyCode,
            toCurrencyCode
          )
        }
        // Must make a copy of the request because this is a shared object
        // reused between requests to other exchange plugins
        const requestToHack = { ...requestTop }
        const requestToExchangeAmount = await toWallet.nativeToDenomination(
          nativeAmount,
          toCurrencyCode
        )
        let fromQuoteNativeAmount = nativeAmount
        let retries = 5
        while (--retries !== 0) {
          requestToHack.nativeAmount = fromQuoteNativeAmount
          const quote = await fetchSwapQuoteInner(requestToHack)
          const toExchangeAmount = await toWallet.nativeToDenomination(
            quote.toNativeAmount,
            toCurrencyCode
          )
          if (gte(toExchangeAmount, requestToExchangeAmount)) {
            return quote
          } else {
            // Get the % difference between the FROM and TO amounts and increase the FROM amount
            // by that %
            const diff = sub(requestToExchangeAmount, toExchangeAmount)
            const percentDiff = div18(diff, requestToExchangeAmount)
            const diffMultiplier = add('1.001', percentDiff)
            fromQuoteNativeAmount = mul(diffMultiplier, fromQuoteNativeAmount)
          }
        }
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
    }
  }
  return out
}

interface ApiResponse<T> {
  result: T | undefined
  status: number
}

const asApiResponse = <T>(cleaner: Cleaner<T>): Cleaner<ApiResponse<T>> =>
  asObject({
    result: asMaybe(cleaner),
    status: asNumber
  })

const asGetRate = asObject({
  // result: asNumber,
  // amount: asNumber,
  // rate: asNumber,
  // withdrawFee: asNumber,
  minAmount: asNumber
})

// const asNetwork = asObject({
//   shortName: asString,
//   isDeposit: asBoolean,
//   isWithdraw: asBoolean,
//   isMemo: asBoolean,
//   isActive: asBoolean
// })

const asCreateOrder = asObject({
  uid: asString,
  // from: asObject({
  //   shortName: asString,
  //   isMemo: asBoolean,
  //   isDeposit: asBoolean,
  //   isWithdraw: asBoolean,
  //   network: asArray(asNetwork)
  // }),
  // to: asObject({
  //   shortName: asString,
  //   isMemo: asBoolean,
  //   isDeposit: asBoolean,
  //   isWithdraw: asBoolean,
  //   network: asArray(asNetwork)
  // }),
  amount: asNumber,
  amountResult: asNumber,
  addressFrom: asString,
  addressTo: asString,
  // addressFromNetwork: asMaybe(asString),
  // addressToNetwork: asString,
  memoFrom: asMaybe(asString),
  // memoTo: asMaybe(asString),
  // createDate: asString,
  finishPayment: asDate
})
