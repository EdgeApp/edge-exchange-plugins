import { ceil, floor, gt, lt } from 'biggystring'
import { asEither, asNull, asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeFetchResponse,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { simpleswap as simpleswapMapping } from '../../mappings/simpleswap'
import {
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyCodeTranscriptionMap,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getCodesWithTranscription,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToRecord,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  getAddress,
  memoType,
  nativeToDenomination
} from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'simpleswap'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'SimpleSwap',
  supportEmail: 'support@simpleswap.io'
}

const asInitOptions = asObject({
  apiKey: asString
})

const orderUri = 'https://simpleswap.io/exchange?id='
const uri = 'https://api.simpleswap.io/v3/'

const expirationMs = 1000 * 60

const INVALID_TOKEN_IDS: InvalidTokenIds = { from: {}, to: {} }

const addressTypeMap: StringMap = {
  digibyte: 'publicAddress',
  zcash: 'transparentAddress'
}

const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  simpleswapMapping
)

// Edge native currencyCode -> SimpleSwap ticker, where they differ
// (verified against the live GET /v3/currencies list)
const CURRENCY_CODE_TRANSCRIPTION: CurrencyCodeTranscriptionMap = {
  avalanche: { AVAX: 'avaxc' },
  binancesmartchain: { BNB: 'bnb-bsc' },
  monad: { MON: 'monad' },
  smartcash: { SMART: 'smart0' },
  telos: { TLOS: 'tlosmain' },
  wax: { WAX: 'waxp' }
}

const asRange = asObject({
  min: asNumberString,
  max: asEither(asNumberString, asNull)
})
const asEstimate = asObject({
  estimatedAmount: asNumberString,
  rateId: asOptional(asString),
  validUntil: asOptional(asString)
})
const asCreatedExchange = asObject({
  id: asString,
  addressFrom: asString,
  extraIdFrom: asOptional(asString),
  amountFrom: asNumberString,
  amountTo: asNumberString
})
const asRangeReply = asObject({ result: asRange })
const asEstimateReply = asObject({ result: asEstimate })
const asCreatedExchangeReply = asObject({ result: asCreatedExchange })

export function makeSimpleSwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)
  if (apiKey === '') {
    throw new Error('SimpleSwap: missing apiKey in initOptions')
  }

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  }

  const resolveNetworks = (
    request: EdgeSwapRequestPlugin
  ): { fromNetwork: string; toNetwork: string } => {
    const fromNetwork =
      MAINNET_CODE_TRANSCRIPTION[
        request.fromWallet.currencyInfo
          .pluginId as keyof CurrencyPluginIdSwapChainCodeMap
      ]
    const toNetwork =
      MAINNET_CODE_TRANSCRIPTION[
        request.toWallet.currencyInfo
          .pluginId as keyof CurrencyPluginIdSwapChainCodeMap
      ]
    if (fromNetwork == null || toNetwork == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    return { fromNetwork, toNetwork }
  }

  const getQuoteForFlow = async (
    request: EdgeSwapRequestPlugin,
    fixed: boolean
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor } = request
    const reverse = quoteFor === 'to'

    const call = async (
      method: 'GET' | 'POST',
      route: string,
      params: { query?: StringMap; body?: unknown }
    ): Promise<unknown> => {
      let response: EdgeFetchResponse
      if (method === 'POST') {
        response = await fetchCors(uri + route, {
          method,
          headers,
          body: JSON.stringify(params.body)
        })
      } else {
        const query = new URLSearchParams(params.query).toString()
        response = await fetchCors(`${uri}${route}?${query}`, {
          method,
          headers
        })
      }

      if (!response.ok) {
        const text = await response.text()
        log.warn(`SimpleSwap ${route} error ${response.status}: ${text}`)
        switch (response.status) {
          case 403:
            throw new SwapPermissionError(swapInfo, 'noVerification')
          // 422 = out of range, but limits are enforced by the /ranges check
          // before estimate/create, so treat it as an unavailable pair here
          case 404:
          case 422:
            throw new SwapCurrencyError(swapInfo, request)
          default:
            throw new Error(`SimpleSwap returned error code ${response.status}`)
        }
      }
      return await response.json()
    }

    const { fromNetwork, toNetwork } = resolveNetworks(request)

    const { fromCurrencyCode, toCurrencyCode } = getCodesWithTranscription(
      request,
      MAINNET_CODE_TRANSCRIPTION,
      CURRENCY_CODE_TRANSCRIPTION
    )

    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet, addressTypeMap[fromWallet.currencyInfo.pluginId]),
      getAddress(toWallet, addressTypeMap[toWallet.currencyInfo.pluginId])
    ])

    const amountWallet = reverse ? toWallet : fromWallet
    const amountTokenId = reverse ? request.toTokenId : request.fromTokenId
    const amount = nativeToDenomination(
      amountWallet,
      request.nativeAmount,
      amountTokenId
    )

    const pairQuery: StringMap = {
      tickerFrom: fromCurrencyCode.toLowerCase(),
      networkFrom: fromNetwork,
      tickerTo: toCurrencyCode.toLowerCase(),
      networkTo: toNetwork,
      fixed: String(fixed),
      reverse: String(reverse)
    }

    const rangeJson = await call('GET', 'ranges', { query: pairQuery })
    const { result: range } = asRangeReply(rangeJson)

    // Native amounts are whole atomic units. Round a minimum up and a maximum
    // down, so rounding never widens the range SimpleSwap actually accepts.
    const limitDirection = reverse ? 'to' : 'from'
    const nativeMin = ceil(
      denominationToNative(amountWallet, range.min, amountTokenId),
      0
    )
    if (lt(request.nativeAmount, nativeMin)) {
      throw new SwapBelowLimitError(swapInfo, nativeMin, limitDirection)
    }
    if (range.max != null) {
      const nativeMax = floor(
        denominationToNative(amountWallet, range.max, amountTokenId),
        0
      )
      if (gt(request.nativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(swapInfo, nativeMax, limitDirection)
      }
    }

    const estimateJson = await call('GET', 'estimates', {
      query: { ...pairQuery, amount }
    })
    const { result: estimate } = asEstimateReply(estimateJson)

    const createJson = await call('POST', 'exchanges', {
      body: {
        tickerFrom: pairQuery.tickerFrom,
        networkFrom: pairQuery.networkFrom,
        tickerTo: pairQuery.tickerTo,
        networkTo: pairQuery.networkTo,
        amount,
        fixed,
        reverse,
        addressTo: toAddress,
        userRefundAddress: fromAddress,
        rateId: estimate.rateId
      }
    })
    const { result: exchange } = asCreatedExchangeReply(createJson)

    const fromNativeAmount = floor(
      denominationToNative(
        fromWallet,
        exchange.amountFrom,
        request.fromTokenId
      ),
      0
    )
    const toNativeAmount = floor(
      denominationToNative(toWallet, exchange.amountTo, request.toTokenId),
      0
    )

    // `amountFrom` is echoed by SimpleSwap and becomes a signed spend. Only a
    // `from` quote pins the source amount locally, so that is the one direction
    // with something to bound against.
    if (!reverse && gt(fromNativeAmount, request.nativeAmount)) {
      throw new Error(
        'SimpleSwap returned a source amount above the requested amount'
      )
    }

    const memos: EdgeMemo[] =
      exchange.extraIdFrom == null
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: exchange.extraIdFrom
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: exchange.addressFrom
        }
      ],
      memos,
      networkFeeOption: 'high',
      assetAction: {
        assetActionType: 'swap'
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        orderId: exchange.id,
        orderUri: orderUri + exchange.id,
        isEstimate: !fixed,
        toAsset: {
          pluginId: toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: fromNativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: toWallet.id,
        refundAddress: fromAddress
      }
    }

    const expirationDate =
      estimate.validUntil != null
        ? ensureInFuture(new Date(estimate.validUntil))
        : new Date(Date.now() + expirationMs)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate
    }
  }

  // How actionable an error is for the user, highest first: a limit error names
  // the amount to retry with, a permission error names an account problem, and
  // "unsupported pair" is the least specific. A transport or server error ranks
  // below all of them, so one flow's outage never masks the other's real answer.
  // edge-core-js error classes are transpiled, so `instanceof SwapCurrencyError`
  // is unreliable — match by name.
  const errorRank = (error: unknown): number => {
    if (!(error instanceof Error)) return 0
    switch (error.name) {
      case 'SwapBelowLimitError':
      case 'SwapAboveLimitError':
        return 3
      case 'SwapPermissionError':
        return 2
      case 'SwapCurrencyError':
        return 1
      default:
        return 0
    }
  }

  const getQuote = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    // Every flow creates its order in its last hop, so a flow that throws never
    // leaves one behind and the float retry is always safe. SimpleSwap rejects
    // fixed-rate orders paying out to a memo/tag chain with a 500 that only the
    // float flow gets past, so the retry is not limited to swap errors.
    let fixedError: unknown
    try {
      return await getQuoteForFlow(request, true)
    } catch (error: unknown) {
      fixedError = error
    }
    try {
      return await getQuoteForFlow(request, false)
    } catch (error: unknown) {
      throw errorRank(fixedError) >= errorRank(error) ? fixedError : error
    }
  }

  // `getMaxSwappable` probe: build a SwapOrder locally, targeting the user's
  // own from-chain address, so `getMaxSpendable` can estimate fees WITHOUT
  // creating (and abandoning) a live SimpleSwap order. The trimmed amount is
  // then run through the real `getQuote`, which creates exactly one order.
  const fetchProbeOrder = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    resolveNetworks(request)
    const fromAddress = await getAddress(
      request.fromWallet,
      addressTypeMap[request.fromWallet.currencyInfo.pluginId]
    )
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          publicAddress: fromAddress
        }
      ],
      networkFeeOption: 'high',
      // Never broadcast; targeting the user's own address trips
      // `SpendToSelfError` on engines whose public key is the address
      // (every EVM chain). The real order below keeps all checks.
      skipChecks: true,
      assetAction: {
        assetActionType: 'swap'
      }
    }
    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: request.nativeAmount,
      expirationDate: new Date(Date.now() + expirationMs)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(fetchProbeOrder, request)
      const swapOrder = await getQuote(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
