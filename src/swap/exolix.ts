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
  EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  getCodes,
  InvalidCurrencyCodes,
  makeSwapPluginQuote
} from '../swap-helpers'

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    binancesmartchain: 'allCodes'
  },
  to: {
    binancesmartchain: 'allCodes',
    zcash: ['ZEC']
  }
}

const pluginId = 'exolix'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Exolix',
  supportEmail: 'support@exolix.com'
}

const orderUri = 'https://exolix.com/transaction/'
const uri = 'https://exolix.com/api/v2/'

const expirationMs = 1000 * 60

const dontUseLegacy: { [cc: string]: boolean } = {
  DGB: true
}

const asRateResponse = asObject({
  minAmount: asNumber
})

const asQuoteInfo = asObject({
  id: asString,
  amount: asNumber,
  amountTo: asNumber,
  depositAddress: asString,
  depositExtraId: asOptional(asString)
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
  const { initOptions, io } = opts
  const { fetchCors = io.fetch } = io

  if (initOptions.apiKey == null) {
    throw new Error('No Exolix apiKey provided.')
  }

  const { apiKey } = initOptions

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

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | undefined
    ): Promise<EdgeSwapQuote> {
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      const fixedPromise = getFixedQuote(request, userSettings)

      const fixedResult = await fixedPromise
      return fixedResult
    }
  }

  const getFixedQuote = async (
    request: EdgeSwapRequest,
    _userSettings: Object | undefined
  ): Promise<EdgeSwapQuote> => {
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

    const nativeQuoteAmount =
      request.quoteFor === 'from'
        ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            request.fromCurrencyCode
          )
        : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            request.toCurrencyCode
          )

    const quoteAmount = parseFloat(nativeQuoteAmount)

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodes(request)

    // Swap the currencies if we need a reverse quote:
    const quoteParams =
      request.quoteFor === 'from'
        ? {
            coinFrom: fromCurrencyCode,
            coinFromNetwork: fromMainnetCode,
            coinTo: toCurrencyCode,
            coinToNetwork: toMainnetCode,
            amount: quoteAmount,
            rateType: 'fixed'
          }
        : {
            coinFrom: toCurrencyCode,
            coinFromNetwork: toMainnetCode,
            coinTo: fromCurrencyCode,
            coinToNetwork: fromMainnetCode,
            amount: quoteAmount,
            rateType: 'fixed'
          }

    // Get Rate
    const rateResponse = asRateResponse(await call('GET', 'rate', quoteParams))

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
    const exchangeParams = {
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

    const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)

    return makeSwapPluginQuote(
      request,
      fromNativeAmount,
      toNativeAmount,
      tx,
      toAddress,
      pluginId,
      false,
      new Date(Date.now() + expirationMs),
      quoteInfo.id
    )
  }

  return out
}
