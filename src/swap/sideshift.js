// @flow

import { asBoolean, asEither, asObject, asOptional, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeFetchFunction,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import {
  ensureInFuture,
  getCodesWithMainnetTranscription,
  makeSwapPluginQuote
} from '../swap-helpers.js'

const MAINNET_CODE_TRANSCRIPTION = {
  zcash: 'shielded'
}

const SIDESHIFT_BASE_URL = 'https://sideshift.ai/api/v2'
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
    const [refundAddress, settleAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodesWithMainnetTranscription(request, MAINNET_CODE_TRANSCRIPTION)

    const rate = asRate(
      await api.get<typeof asRate>(
        `/pair/${fromCurrencyCode}-${fromMainnetCode}/${toCurrencyCode}-${toMainnetCode}`
      )
    )

    if (rate.error) {
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

    if (fixedQuote.error) {
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

    const amountExpectedToNative = await request.toWallet.denominationToNative(
      order.settleAmount,
      request.toCurrencyCode
    )

    const isEstimate = false

    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: spendInfoAmount,
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

    const tx = await request.fromWallet.makeSpend(spendInfo)

    return makeSwapPluginQuote(
      request,
      amountExpectedFromNative,
      amountExpectedToNative,
      tx,
      settleAddress,
      pluginId,
      isEstimate,
      ensureInFuture(new Date(order.expiresAt)),
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

interface Rate {
  rate: string;
  min: string;
  max: string;
}

interface SideshiftApi {
  get: <R>(path: string) => Promise<R>;
  post: <R>(path: string, body: {}) => Promise<R>;
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
