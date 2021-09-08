// @flow

import { asBoolean, asEither, asObject, asOptional, asString } from 'cleaners'
import {
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
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
  type EdgeSwapRequest
} from 'edge-core-js/types'

import { ensureInFuture, makeSwapPluginQuote } from '../swap-helpers.js'

// Invalid currency codes should *not* have transcribed codes
// because currency codes with transcribed versions are NOT invalid
const CURRENCY_CODE_TRANSCRIPTION = {
  // Edge currencyCode: exchangeCurrencyCode
  USDT: 'usdtErc20'
}
const INVALID_CURRENCY_CODES = {
  FTM: true
}
const SIDESHIFT_BASE_URL = 'https://sideshift.ai/api/v1'
const pluginId = 'sideshift'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'SideShift.ai',
  supportEmail: 'help@sideshift.ai'
}
const ORDER_STATUS_URL = 'https://sideshift.ai/orders/'

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.segwitAddress ?? addressInfo.publicAddress
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
  const { fromCurrencyCode, fromWallet, toCurrencyCode } = request

  if (quoteErrorMessage === 'Amount too low') {
    const nativeMin = await fromWallet.denominationToNative(
      rate.min,
      fromCurrencyCode
    )
    throw new SwapBelowLimitError(swapInfo, nativeMin)
  }

  if (quoteErrorMessage === 'Amount too high') {
    const nativeMax = await fromWallet.denominationToNative(
      rate.max,
      fromCurrencyCode
    )
    throw new SwapAboveLimitError(swapInfo, nativeMax)
  }

  if (
    /method/i.test(quoteErrorMessage) &&
    /disabled/i.test(quoteErrorMessage)
  ) {
    throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
  }

  if (/country-blocked/i.test(quoteErrorMessage)) {
    throw new SwapPermissionError(swapInfo, 'geoRestriction')
  }
  throw new Error(`SideShift.ai error ${quoteErrorMessage}`)
}

const createSideshiftApi = (baseUrl: string, fetch: EdgeFetchFunction) => {
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

const createFetchSwapQuote = (api: SideshiftApi, affiliateId: string) =>
  async function fetchSwapQuote(
    request: EdgeSwapRequest
  ): Promise<EdgeSwapQuote> {
    if (
      INVALID_CURRENCY_CODES[request.fromCurrencyCode] ||
      INVALID_CURRENCY_CODES[request.toCurrencyCode]
    ) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }

    const [depositAddress, settleAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])

    const { safeFromCurrencyCode, safeToCurrencyCode } = getSafeCurrencyCode(
      request
    )

    const rate = asRate(
      await api.get<typeof asRate>(
        `/pairs/${safeFromCurrencyCode}/${safeToCurrencyCode}`
      )
    )

    if (rate.error) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }

    const permissions = asPermissions(await api.get<Permission>('/permissions'))

    if (!permissions.createOrder || !permissions.createQuote) {
      throw new SwapPermissionError(swapInfo, 'geoRestriction')
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
        : (parseFloat(quoteAmount) / parseFloat(rate.rate))
            .toFixed(8)
            .toString()

    const fixedQuoteRequest = asFixedQuoteRequest({
      depositMethod: safeFromCurrencyCode,
      settleMethod: safeToCurrencyCode,
      depositAmount
    })

    const fixedQuote = asFixedQuote(
      await api.post<typeof asFixedQuote>('/quotes', fixedQuoteRequest)
    )

    if (fixedQuote.error) {
      await checkQuoteError(rate, request, fixedQuote.error.message)
      throw new Error(`SideShift.ai error ${fixedQuote.error.message}`)
    }

    const orderRequest = asOrderRequest({
      type: 'fixed',
      quoteId: fixedQuote.id,
      affiliateId,
      settleAddress,
      refundAddress: depositAddress
    })

    const order = asOrder(
      await api.post<typeof asOrder>('/orders', orderRequest)
    )

    if (order.error) {
      await checkQuoteError(rate, request, order.error.message)
      throw new Error(`SideShift.ai error ${order.error.message}`)
    }

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
          publicAddress: order.depositAddress.address,
          uniqueIdentifier: order.depositAddress.memo
        }
      ],
      networkFeeOption:
        request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
      swapData: {
        orderId: order.orderId,
        orderUri: ORDER_STATUS_URL + order.orderId,
        isEstimate,
        payoutAddress: settleAddress,
        payoutCurrencyCode: safeToCurrencyCode.toUpperCase(),
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
      ensureInFuture(new Date(order.expiresAtISO)),
      order.id
    )
  }

export function makeSideshiftPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, initOptions } = opts

  const api = createSideshiftApi(SIDESHIFT_BASE_URL, io.fetchCors || io.fetch)

  const fetchSwapQuote = createFetchSwapQuote(api, initOptions.affiliateId)

  return {
    swapInfo,
    fetchSwapQuote
  }
}

interface SideshiftApi {
  get: <R>(path: string) => Promise<R>;
  post: <R>(path: string, body: {}) => Promise<R>;
}

interface Permission {
  createOrder: boolean;
  createQuote: boolean;
}

interface Rate {
  rate: string;
  min: string;
  max: string;
}

const asError = asObject({ error: asObject({ message: asString }) })

const asPermissions = asObject({
  createOrder: asBoolean,
  createQuote: asBoolean
})

const asRate = asEither(
  asObject({
    rate: asString,
    min: asString,
    max: asString
  }),
  asError
)

const asFixedQuoteRequest = asObject({
  depositMethod: asString,
  settleMethod: asString,
  depositAmount: asString
})

const asFixedQuote = asEither(
  asObject({
    id: asString
  }),
  asError
)

const asOrderRequest = asObject({
  type: asString,
  quoteId: asString,
  affiliateId: asString,
  settleAddress: asString,
  refundAddress: asString
})

const asOrder = asEither(
  asObject({
    expiresAtISO: asString,
    depositAddress: asObject({
      address: asString,
      memo: asOptional(asString)
    }),
    id: asString,
    orderId: asString,
    settleAmount: asString,
    depositAmount: asString
  }),
  asError
)
