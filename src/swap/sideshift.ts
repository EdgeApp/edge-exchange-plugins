import { asBoolean, asEither, asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeFetchFunction,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  JsonObject,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import {
  ensureInFuture,
  getCodesWithTranscription,
  makeSwapPluginQuote,
  SwapOrder
} from '../swap-helpers'
import { convertRequest } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'

const MAINNET_CODE_TRANSCRIPTION = {
  zcash: 'shielded',
  binancesmartchain: 'bsc'
}

const SIDESHIFT_BASE_URL = 'https://sideshift.ai/api/v2'
const pluginId = 'sideshift'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
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

async function checkQuoteError(
  rate: Rate,
  request: EdgeSwapRequestPlugin,
  quoteErrorMessage: string
): Promise<void> {
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

interface CreateSideshiftApiResponse {
  get: <R>(path: string) => Promise<R>
  post: <R>(path: string, body: {}) => Promise<R>
}

const createSideshiftApi = (
  baseUrl: string,
  fetch: EdgeFetchFunction
): CreateSideshiftApiResponse => {
  async function request<R>(
    method: 'GET' | 'POST',
    path: string,
    body?: JsonObject
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
    get: async <R>(path: string): Promise<R> => await request<R>('GET', path),
    post: async <R>(path: string, body: {}): Promise<R> =>
      await request<R>('POST', path, body)
  }
}

const fetchSwapQuoteInner = async (
  request: EdgeSwapRequestPlugin,
  api: SideshiftApi,
  affiliateId: string
): Promise<SwapOrder> => {
  const [refundAddress, settleAddress] = await Promise.all([
    getAddress(request.fromWallet, request.fromCurrencyCode),
    getAddress(request.toWallet, request.toCurrencyCode)
  ])

  const {
    fromCurrencyCode,
    toCurrencyCode,
    fromMainnetCode,
    toMainnetCode
  } = getCodesWithTranscription(request, MAINNET_CODE_TRANSCRIPTION)

  const rate = asRate(
    await api.get<typeof asRate>(
      `/pair/${fromCurrencyCode}-${fromMainnetCode}/${toCurrencyCode}-${toMainnetCode}`
    )
  )

  if ('error' in rate) {
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode,
      request.toCurrencyCode
    )
  }

  const permissions = asPermissions(
    await api.get<typeof asPermissions>('/permissions')
  )

  if (!permissions.createShift) {
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

  const fixedQuoteRequest = asFixedQuoteRequest({
    depositCoin: fromCurrencyCode,
    depositNetwork: fromMainnetCode,
    settleCoin: toCurrencyCode,
    settleNetwork: toMainnetCode,
    depositAmount: request.quoteFor === 'from' ? quoteAmount : undefined,
    settleAmount: request.quoteFor === 'to' ? quoteAmount : undefined,
    affiliateId
  })

  const fixedQuote = asFixedQuote(
    await api.post<typeof asFixedQuote>('/quotes', fixedQuoteRequest)
  )

  if ('error' in fixedQuote) {
    await checkQuoteError(rate, request, fixedQuote.error.message)
    throw new Error(`SideShift.ai error ${fixedQuote.error.message}`)
  }

  const shiftRequest = asShiftRequest({
    quoteId: fixedQuote.id,
    affiliateId,
    settleAddress,
    refundAddress
  })

  const order = asOrder(
    await api.post<typeof asOrder>('/shifts/fixed', shiftRequest)
  )

  if ('error' in order) {
    await checkQuoteError(rate, request, order.error.message)
    throw new Error(`SideShift.ai error ${order.error.message}`)
  }

  const amountExpectedFromNative = await request.fromWallet.denominationToNative(
    order.depositAmount,
    request.fromCurrencyCode
  )

  const amountExpectedToNative = await request.toWallet.denominationToNative(
    order.settleAmount,
    request.toCurrencyCode
  )

  const isEstimate = false

  const spendInfo: EdgeSpendInfo = {
    currencyCode: request.fromCurrencyCode,
    spendTargets: [
      {
        nativeAmount: amountExpectedFromNative,
        publicAddress: order.depositAddress,
        uniqueIdentifier: order.depositMemo
      }
    ],
    networkFeeOption:
      request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
    swapData: {
      orderId: order.id,
      orderUri: ORDER_STATUS_URL + order.id,
      isEstimate,
      payoutAddress: settleAddress,
      payoutCurrencyCode: request.toCurrencyCode,
      payoutNativeAmount: amountExpectedToNative,
      payoutWalletId: request.toWallet.id,
      plugin: { ...swapInfo },
      refundAddress
    }
  }

  return {
    request,
    spendInfo,
    swapInfo,
    fromNativeAmount: amountExpectedFromNative,
    expirationDate: ensureInFuture(new Date(order.expiresAt))
  }
}

const createFetchSwapQuote = (api: SideshiftApi, affiliateId: string) =>
  async function fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
    const request = convertRequest(req)

    const swapOrder = await fetchSwapQuoteInner(request, api, affiliateId)
    return await makeSwapPluginQuote(swapOrder)
  }

export function makeSideshiftPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, initOptions } = opts
  const api = createSideshiftApi(SIDESHIFT_BASE_URL, io.fetchCors ?? io.fetch)
  const fetchSwapQuote = createFetchSwapQuote(api, initOptions.affiliateId)

  return {
    swapInfo,
    fetchSwapQuote
  }
}

interface Rate {
  rate: string
  min: string
  max: string
}

interface SideshiftApi {
  get: <R>(path: string) => Promise<R>
  post: <R>(path: string, body: {}) => Promise<R>
}

const asError = asObject({ error: asObject({ message: asString }) })

const asPermissions = asObject({
  createShift: asBoolean
})

const asRate = asEither(
  asObject({
    rate: asString,
    min: asString,
    max: asString,
    depositCoin: asString,
    depositNetwork: asString,
    settleCoin: asString,
    settleNetwork: asString
  }),
  asError
)

const asFixedQuoteRequest = asObject({
  depositCoin: asString,
  depositNetwork: asString,
  settleCoin: asString,
  settleNetwork: asString,
  depositAmount: asOptional(asString),
  settleAmount: asOptional(asString),
  affiliateId: asString
})

const asFixedQuote = asEither(
  asObject({
    id: asString
  }),
  asError
)

const asShiftRequest = asObject({
  quoteId: asString,
  affiliateId: asString,
  settleAddress: asString,
  refundAddress: asString
})

const asOrder = asEither(
  asObject({
    id: asString,
    expiresAt: asString,
    depositAddress: asString,
    depositMemo: asOptional(asString),
    settleAmount: asString,
    depositAmount: asString
  }),
  asError
)
