// @flow

import {
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapPermissionError
} from 'edge-core-js'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeFetchFunction,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  SwapCurrencyError
} from 'edge-core-js/types'

import { makeSwapPluginQuote } from '../swap-helpers.js'

// Invalid currency codes should *not* have transcribed codes
// because currency codes with transcribed versions are NOT invalid
const CURRENCY_CODE_TRANSCRIPTION = {
  // Edge currencyCode: exchangeCurrencyCode
  USDT: 'usdtErc20'
}
const SIDESHIFT_BASE_URL = 'https://sideshift.ai/api/v1'
const pluginId = 'sideshift'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'SideShift.ai',
  supportEmail: 'help@sideshift.ai'
}

type FixedQuote = {
  createdAt: string,
  depositAmount: string,
  depositMethod: string,
  expiresAt: string,
  id: string,
  rate: string,
  settleAmount: string,
  settleMethod: string,
  error?: { message: string }
}

type FixedQuoteRequest = {
  depositMethod: string,
  settleMethod: string,
  depositAmount: string
}

type Order = {
  createdAt: string,
  createdAtISO: string,
  expiresAt: string,
  expiresAtISO: string,
  depositAddress: {
    address: string
  },
  depositMethod: string,
  id: string,
  orderId: string,
  settleAddress: {
    address: string
  },
  settleMethod: string,
  depositMax: string,
  depositMin: string,
  quoteId: string,
  settleAmount: string,
  depositAmount: string,
  deposits: Array<any>
}

type OrderRequest = {
  type: string,
  quoteId: string,
  affiliateId: string,
  sessionSecret?: string,
  settleAddress: string
}

type Rate = {
  rate: number,
  min: string,
  max: string,
  error?: {
    message: string
  }
}

type Permissions = {
  createOrder: boolean,
  createQuote: boolean
}

const dontUseLegacy = {}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

function getSafeCurrencyCode(request: EdgeSwapRequest) {
  const { fromCurrencyCode, toCurrencyCode } = request

  const safeFromCurrencyCode =
    CURRENCY_CODE_TRANSCRIPTION[fromCurrencyCode] ||
    fromCurrencyCode.toLowerCase()

  const safeToCurrencyCode =
    CURRENCY_CODE_TRANSCRIPTION[toCurrencyCode] || toCurrencyCode.toLowerCase()

  return { safeFromCurrencyCode, safeToCurrencyCode }
}

async function checkQuoteError(
  rate: Rate,
  request: EdgeSwapRequest,
  quoteErrorMessage: string
) {
  const { fromCurrencyCode, fromWallet } = request

  const nativeMin = await fromWallet.denominationToNative(
    rate.min,
    fromCurrencyCode
  )

  const nativeMax = await fromWallet.denominationToNative(
    rate.max,
    fromCurrencyCode
  )

  if (quoteErrorMessage === 'Amount too low') {
    throw new SwapBelowLimitError(swapInfo, nativeMin)
  }

  if (quoteErrorMessage === 'Amount too high') {
    throw new SwapAboveLimitError(swapInfo, nativeMax)
  }
}

export function makeSideshiftPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, initOptions } = opts

  const api = createSideshiftApi(SIDESHIFT_BASE_URL, io.fetchCors || io.fetch)

  async function fetchSwapQuote(
    request: EdgeSwapRequest
  ): Promise<EdgeSwapQuote> {
    const permissions = await api.get<Permissions>('/permissions')

    if (!permissions.createOrder || !permissions.createQuote) {
      throw new SwapPermissionError(swapInfo, 'geoRestriction')
    }

    const [depositAddress, settleAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])

    const {
      safeFromCurrencyCode,
      safeToCurrencyCode
    } = await getSafeCurrencyCode(request)

    const rate = await api.get<Rate>(
      `/pairs/${safeFromCurrencyCode}/${safeToCurrencyCode}`
    )

    if (rate.error) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }

    const quoteAmount = await (request.quoteFor === 'from'
      ? request.fromWallet.nativeToDenomination(
          request.nativeAmount,
          request.fromCurrencyCode
        )
      : request.toWallet.nativeToDenomination(
          request.nativeAmount,
          request.toCurrencyCode
        ))

    const depositAmount =
      request.quoteFor === 'from'
        ? quoteAmount
        : (parseFloat(quoteAmount) / rate.rate).toFixed(8).toString()

    const fixedQuoteRequest: FixedQuoteRequest = {
      depositMethod: safeFromCurrencyCode,
      settleMethod: safeToCurrencyCode,
      depositAmount
    }

    const fixedQuote = await api.post<FixedQuote>('/quotes', fixedQuoteRequest)

    if (fixedQuote.error) {
      await checkQuoteError(rate, request, fixedQuote.error.message)
    }

    const orderRequest: OrderRequest = {
      type: 'fixed',
      quoteId: fixedQuote.id,
      affiliateId: initOptions.affiliateId,
      settleAddress
    }

    const order = await api.post<Order>('/orders', orderRequest)

    const spendInfoAmount = await request.fromWallet.denominationToNative(
      order.depositAmount,
      request.fromCurrencyCode.toUpperCase()
    )

    const amountExpectedFromNative = await request.fromWallet.denominationToNative(
      order.depositAmount,
      request.fromCurrencyCode
    )

    const amountExpectedToNative = await request.fromWallet.denominationToNative(
      order.settleAmount,
      request.toCurrencyCode
    )

    const isEstimate = false

    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: spendInfoAmount,
          publicAddress: order.depositAddress.address
        }
      ],
      networkFeeOption:
        request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
      swapData: {
        orderId: order.orderId,
        isEstimate,
        payoutAddress: settleAddress,
        payoutCurrencyCode: safeToCurrencyCode,
        payoutNativeAmount: amountExpectedToNative,
        payoutWalletId: request.toWallet.id,
        plugin: { ...swapInfo },
        refundAddress: depositAddress
      }
    }

    const tx = await request.fromWallet.makeSpend(spendInfo)

    return makeSwapPluginQuote(
      request,
      amountExpectedFromNative,
      amountExpectedToNative,
      tx,
      settleAddress,
      pluginId,
      isEstimate,
      new Date(order.expiresAtISO),
      order.id
    )
  }

  return {
    swapInfo,
    fetchSwapQuote
  }
}

function createSideshiftApi(baseUrl: string, fetch: EdgeFetchFunction) {
  async function request<R>(
    method: 'GET' | 'POST',
    path: string,
    body: ?{}
  ): Promise<R> {
    const url = `${baseUrl}${path}`

    const reply = await (method === 'GET'
      ? fetch(url)
      : fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }))

    try {
      return await reply.json()
    } catch (e) {
      throw new Error(`SideShift.ai returned error code ${reply.status}`)
    }
  }

  return {
    get: <R>(path: string): Promise<R> => request<R>('GET', path),
    post: <R>(path: string, body: {}): Promise<R> =>
      request<R>('POST', path, body)
  }
}
