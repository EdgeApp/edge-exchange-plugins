import { lt } from 'biggystring'
import { asNumber, asObject, asOptional, asString } from 'cleaners'
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
  getCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../swap-helpers'
import { convertRequest } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'

const pluginId = 'exolix'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Exolix',
  supportEmail: 'support@exolix.com'
}

const asInitOptions = asObject({
  apiKey: asString
})

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    ethereum: ['MATIC'],
    polygon: 'allCodes',
    binancesmartchain: 'allCodes'
  },
  to: {
    ethereum: ['MATIC'],
    polygon: 'allCodes',
    binancesmartchain: 'allCodes',
    zcash: ['ZEC']
  }
}

const orderUri = 'https://exolix.com/transaction/'
const uri = 'https://exolix.com/api/'

const expirationMs = 1000 * 60

const dontUseLegacy: { [cc: string]: boolean } = {
  DGB: true
}

const asRateResponse = asObject({
  min_amount: asString
})

const asQuoteInfo = asObject({
  id: asString,
  amount_from: asNumber,
  amount_to: asNumber,
  deposit_address: asString,
  deposit_extra: asOptional(asString)
})

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({
    currencyCode
  })

  return addressInfo.legacyAddress != null && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeExolixPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  async function call(route: string, params: any): Promise<Object> {
    const body = JSON.stringify(params)

    const headers: { [header: string]: string } = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `${apiKey}`
    }

    const response = await fetchCors(uri + route, {
      method: 'POST',
      body,
      headers
    })

    if (!response.ok) {
      if (response.status === 422) {
        throw new SwapCurrencyError(swapInfo, params.coin_from, params.coin_to)
      }
      throw new Error(`Exolix returned error code ${response.status}`)
    }

    return await response.json()
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      const { request: newRequest } = await getMaxSwappable(
        async request => await getFixedQuote(request, userSettings),
        request
      )
      const fixedOrder = await getFixedQuote(newRequest, userSettings)
      const fixedResult = await makeSwapPluginQuote(fixedOrder)

      return fixedResult
    }
  }

  const getFixedQuote = async (
    request: EdgeSwapRequestPlugin,
    _userSettings: Object | undefined
  ): Promise<SwapOrder> => {
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])

    if (request.quoteFor === 'to') {
      // Does not yet support reverse quotes
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }

    const quoteAmount =
      request.quoteFor === 'from'
        ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            request.fromCurrencyCode
          )
        : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            request.toCurrencyCode
          )

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodes(request)

    // The Exolix documentation doesn't detail this mainnetCode:currencyCode functionality
    // but it's been verified by testing
    const safeFromCurrencyCode = `${fromMainnetCode}:${fromCurrencyCode}`
    const safeToCurrencyCode = `${toMainnetCode}:${toCurrencyCode}`

    // Swap the currencies if we need a reverse quote:
    const quoteParams =
      request.quoteFor === 'from'
        ? {
            coin_from: safeFromCurrencyCode,
            coin_to: safeToCurrencyCode,
            deposit_amount: quoteAmount,
            rate_type: 'fixed'
          }
        : {
            coin_from: safeToCurrencyCode,
            coin_to: safeFromCurrencyCode,
            deposit_amount: quoteAmount,
            rate_type: 'fixed'
          }

    // Get Rate
    const rateResponse = asRateResponse(await call('rate', quoteParams))

    // Check rate minimum:
    if (request.quoteFor === 'from') {
      const nativeMin = await request.fromWallet.denominationToNative(
        rateResponse.min_amount,
        request.fromCurrencyCode
      )

      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }
    } else {
      const nativeMin = await request.toWallet.denominationToNative(
        rateResponse.min_amount,
        request.toCurrencyCode
      )

      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin, 'to')
      }
    }

    // Make the transaction:
    const exchangeParams = {
      coin_from: quoteParams.coin_from,
      coin_to: quoteParams.coin_to,
      deposit_amount: quoteAmount,
      destination_address: toAddress,
      destination_extra: '',
      refund_address: fromAddress,
      refund_extra: '',
      rate_type: 'fixed'
    }

    const callJson = await call('exchange', exchangeParams)
    const quoteInfo = asQuoteInfo(callJson)

    const fromNativeAmount = await request.fromWallet.denominationToNative(
      quoteInfo.amount_from.toString(),
      request.fromCurrencyCode
    )

    const toNativeAmount = await request.toWallet.denominationToNative(
      quoteInfo.amount_to.toString(),
      request.toCurrencyCode
    )

    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteInfo.deposit_address,
          uniqueIdentifier: quoteInfo.deposit_extra
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

    const order = {
      request,
      spendInfo,
      pluginId,
      expirationDate: new Date(Date.now() + expirationMs)
    }

    return order
  }

  return out
}
