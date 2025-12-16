import { gt, lt } from 'biggystring'
import {
  asArray,
  asDate,
  asEither,
  asMaybe,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  Cleaner
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { changenow as changenowMapping } from '../../mappings/changenow'
import {
  ChainCodeTickerMap,
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  EdgeIdSwapIdMap,
  ensureInFuture,
  getChainAndTokenCodes,
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
import { EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'changenow'

export const swapInfo: EdgeSwapInfo = {
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

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

/**
 * Network names that don't match parent network currency code.
 * See https://changenow.io/currencies for list of supported currencies.
 *
 * Use this command to list currencies supported:
 *
 * ```sh
 * curl 'https://api.changenow.io/v2/exchange/currencies?isFiat=false'
 * ```
 */
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  changenowMapping
)

export const SPECIAL_MAINNET_CASES: EdgeIdSwapIdMap = new Map([
  ['avalanche', new Map([[null, { chainCode: 'cchain', tokenCode: 'avax' }]])]
])

// Provider data
let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60 // 1 hour

export function makeChangeNowPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'x-changenow-api-key': apiKey
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const response = await fetchCors(
        `${uri}exchange/currencies?active=true&isFiat=false`
      )
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message)
      }
      const json = await response.json()
      const assets = asChangeNowAssets(json)

      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
      const out: ChainCodeTickerMap = new Map()
      for (const asset of assets) {
        if (chaincodeArray.includes(asset.network)) {
          const tokenCodes = out.get(asset.network) ?? []
          tokenCodes.push({
            tokenCode: asset.ticker,
            contractAddress: asset.tokenContract
          })
          out.set(asset.network, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('ChangeNow: Error updating supported assets', e)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const { promoCode } = opts
    const { nativeAmount } = request

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(
        request.fromWallet,
        addressTypeMap[request.fromWallet.currencyInfo.pluginId]
      ),
      getAddress(
        request.toWallet,
        addressTypeMap[request.toWallet.currencyInfo.pluginId]
      )
    ])

    const changenowCodes = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION,
      SPECIAL_MAINNET_CASES
    )

    const currencyString = `fromCurrency=${changenowCodes.fromCurrencyCode}&toCurrency=${changenowCodes.toCurrencyCode}&fromNetwork=${changenowCodes.fromMainnetCode}&toNetwork=${changenowCodes.toMainnetCode}`

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
        throw new SwapCurrencyError(swapInfo, request)

      const { rateId, validUntil } = asExchange(exchangeAmountResponseJson)

      // Create order
      const orderBody = {
        fromCurrency: changenowCodes.fromCurrencyCode,
        toCurrency: changenowCodes.toCurrencyCode,
        fromNetwork: changenowCodes.fromMainnetCode,
        toNetwork: changenowCodes.toMainnetCode,
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
      const largeDenomAmount = nativeToDenomination(
        request.fromWallet,
        nativeAmount,
        request.fromTokenId
      )

      // Get min and max
      const marketRangeResponse = await fetchCors(
        uri + `exchange/range?flow=${flow}&${currencyString}`,
        { headers }
      )
      const marketRangeResponseJson = await marketRangeResponse.json()

      if (marketRangeResponseJson.error != null)
        throw new SwapCurrencyError(swapInfo, request)

      const { minAmount, maxAmount } = asMarketRange(marketRangeResponseJson)

      if (lt(largeDenomAmount, minAmount.toString())) {
        const minNativeAmount = denominationToNative(
          request.fromWallet,
          minAmount.toString(),
          request.fromTokenId
        )
        throw new SwapBelowLimitError(swapInfo, minNativeAmount)
      }

      if (maxAmount != null && gt(largeDenomAmount, maxAmount.toString())) {
        const maxNativeAmount = denominationToNative(
          request.fromWallet,
          maxAmount.toString(),
          request.fromTokenId
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

      const toNativeAmount = denominationToNative(
        request.toWallet,
        toAmount.toString(),
        request.toTokenId
      )

      const memos: EdgeMemo[] =
        payinExtraId == null
          ? []
          : [
              {
                type: memoType(request.fromWallet.currencyInfo.pluginId),
                value: payinExtraId
              }
            ]

      const spendInfo: EdgeSpendInfo = {
        tokenId: request.fromTokenId,
        spendTargets: [
          {
            nativeAmount,
            publicAddress: payinAddress
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
          orderId: id,
          orderUri: orderUri + id,
          isEstimate: flow === 'standard',
          toAsset: {
            pluginId: request.toWallet.currencyInfo.pluginId,
            tokenId: request.toTokenId,
            nativeAmount: toNativeAmount
          },
          fromAsset: {
            pluginId: request.fromWallet.currencyInfo.pluginId,
            tokenId: request.fromTokenId,
            nativeAmount
          },
          payoutAddress: toAddress,
          payoutWalletId: request.toWallet.id,
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
      const largeDenomAmount = nativeToDenomination(
        request.toWallet,
        nativeAmount,
        request.toTokenId
      )

      const {
        fromAmount,
        payinAddress,
        payinExtraId,
        id,
        validUntil
      } = await createOrder(flow, false, largeDenomAmount)

      const fromNativeAmount = denominationToNative(
        request.fromWallet,
        fromAmount.toString(),
        request.fromTokenId
      )

      const memos: EdgeMemo[] =
        payinExtraId == null
          ? []
          : [
              {
                type: memoType(request.fromWallet.currencyInfo.pluginId),
                value: payinExtraId
              }
            ]

      const spendInfo: EdgeSpendInfo = {
        tokenId: request.fromTokenId,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: payinAddress
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
          orderId: id,
          orderUri: orderUri + id,
          isEstimate: false,
          toAsset: {
            pluginId: request.toWallet.currencyInfo.pluginId,
            tokenId: request.toTokenId,
            nativeAmount: nativeAmount
          },
          fromAsset: {
            pluginId: request.fromWallet.currencyInfo.pluginId,
            tokenId: request.fromTokenId,
            nativeAmount: fromNativeAmount
          },
          payoutAddress: toAddress,
          payoutWalletId: request.toWallet.id,
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

      // Fetch and persist chaincode/tokencode maps from provider
      await fetchSupportedAssets()

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

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

const asChangeNowAssets = asArray(
  asObject({
    ticker: asString, // "btc",
    // "name": "Bitcoin",
    // "image": "https://content-api.changenow.io/uploads/btc_1_527dc9ec3c.svg",
    // "hasExternalId": false,
    // "isExtraIdSupported": false,
    // "isFiat": false,
    // "featured": true,
    // "isStable": false,
    // "supportsFixedRate": true,
    network: asString, // "btc",
    tokenContract: asEither(asNull, asString) // null,
    // "buy": true,
    // "sell": true,
    // "legacyTicker": "btc"
  })
)
