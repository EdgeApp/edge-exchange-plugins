import {
  asArray,
  asBoolean,
  asEither,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue,
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
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { xgram as xgramMapping } from '../../mappings/xgram'
import {
  ChainCodeTickerMap,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  ensureInFuture,
  getChainAndTokenCodes,
  getMaxSwappable,
  makeSwapPluginQuote,
  mapToRecord,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'

const pluginId = 'xgram'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Xgram',
  supportEmail: 'support@xgram.io'
}

const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString)
})

const orderUri = 'https://xgram.io/exchange/order?id='
const uri = 'https://xgram.io/api/v1/'
const newExchange = 'launch-new-exchange'
const newRevExchange = 'launch-new-payment-exchange'
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  xgramMapping
)

let chainCodeTickerMap: ChainCodeTickerMap = new Map()

const swapType: FlowType = 'fixed'
type FlowType = 'fixed' | 'float'

export function makeXgramPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts

  const fetchCors = io.fetch
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION && lastUpdated !== 0) return
    try {
      const response = await fetchCors(`${uri}list-currency-options`, {
        headers
      })

      const json = await response.json()
      const jsonArr = Object.entries(json).map(([key, data]) => ({
        ...(data as object),
        coinName: key
      }))
      const assets = asXgramAssets(jsonArr)
      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
        .filter((v): v is string => v != null)
        .map(v => v.toLowerCase())
      const out: ChainCodeTickerMap = new Map()

      for (const asset of assets) {
        const chain = asset.network.toLowerCase()
        if (chaincodeArray.includes(chain)) {
          const tokenCodes = out.get(chain) ?? []

          tokenCodes.push({
            tokenCode: asset.coinName,
            contractAddress:
              asset.contract != null && asset.contract !== ''
                ? asset.contract
                : null
          })
          out.set(chain, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('Xgram: Error updating supported assets', e)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, nativeAmount } = request

    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet),
      getAddress(toWallet)
    ])

    const xgramCodes = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION
    )

    async function createOrder(
      isSelling: boolean,
      largeDenomAmount: string
    ): Promise<XgramResponse> {
      const orderBody = {
        fromCurrency: xgramCodes.fromCurrencyCode,
        toCurrency: xgramCodes.toCurrencyCode,
        fromAmount: isSelling ? largeDenomAmount : '',
        toAmount: isSelling ? '' : largeDenomAmount,
        address: toAddress,
        refundAddress: fromAddress
      }

      const createExchangeUrl = isSelling ? newExchange : newRevExchange

      const qs = new URLSearchParams({
        toAddress: String(toAddress),
        refundAddress: String(fromAddress),
        fromCcy: orderBody.fromCurrency,
        toCcy: orderBody.toCurrency,
        ccyAmount: largeDenomAmount,
        type: swapType
      }).toString()

      const orderResponse = await fetchCors(
        uri + createExchangeUrl + `?${qs}`,
        {
          headers
        }
      )

      if (!orderResponse.ok) {
        throw new Error('Xgram create order failed')
      }

      const orderResponseJson = await orderResponse.json()
      const quoteFor = request?.quoteFor === 'from' ? 'from' : 'to'

      const quoteReply = asTemplateQuoteReply(orderResponseJson)

      if ('errors' in quoteReply) {
        const errors = quoteReply.errors
        if (errors.find(error => error.code === 'REGION_UNSUPPORTED') != null) {
          throw new SwapPermissionError(swapInfo, 'geoRestriction')
        }

        if (
          errors.find(error => error.code === 'CURRENCY_UNSUPPORTED') != null
        ) {
          throw new SwapCurrencyError(swapInfo, request)
        }
        const limitError = errors.find(
          error => error.code === 'BELOW_LIMIT' || error.code === 'ABOVE_LIMIT'
        )

        if (limitError?.code === 'BELOW_LIMIT') {
          const sourceAmountLimit = denominationToNative(
            isSelling ? request.fromWallet : request.toWallet,
            limitError.sourceAmountLimit,
            isSelling ? request.fromTokenId : request.toTokenId
          )

          throw new SwapBelowLimitError(swapInfo, sourceAmountLimit, quoteFor)
        }
        if (limitError?.code === 'ABOVE_LIMIT') {
          const sourceAmountLimit = denominationToNative(
            isSelling ? request.fromWallet : request.toWallet,
            limitError.sourceAmountLimit,
            isSelling ? request.fromTokenId : request.toTokenId
          )
          throw new SwapAboveLimitError(swapInfo, sourceAmountLimit, quoteFor)
        }
        throw new Error('Xgram create order error')
      }

      let parsedValidUntil: Date | null = null
      if (orderResponseJson.expiresAt != null) {
        const maybe = new Date(orderResponseJson.expiresAt)
        if (!Number.isNaN(maybe.getTime())) parsedValidUntil = maybe
      }

      return {
        id: orderResponseJson.id,
        validUntil: parsedValidUntil,
        fromAmount: isSelling
          ? orderBody.fromAmount
          : orderResponseJson.ccyAmountFrom,
        toAmount: isSelling
          ? orderResponseJson.ccyAmountToExpected
          : orderBody.toAmount,
        payinAddress: orderResponseJson.depositAddress,
        payinExtraId: orderResponseJson.depositTag
      }
    }

    async function swapExchange(isSelling: boolean): Promise<SwapOrder> {
      const largeDenomAmount = nativeToDenomination(
        isSelling ? request.fromWallet : request.toWallet,
        nativeAmount,
        isSelling ? request.fromTokenId : request.toTokenId
      )

      const {
        fromAmount,
        toAmount,
        payinAddress,
        payinExtraId,
        id,
        validUntil
      } = await createOrder(isSelling, largeDenomAmount)

      const fromNativeAmount = denominationToNative(
        request.fromWallet,
        fromAmount.toString(),
        request.fromTokenId
      )
      const toNativeAmount = denominationToNative(
        request.toWallet,
        toAmount.toString(),
        request.toTokenId
      )

      const memos: EdgeMemo[] =
        payinExtraId == null || payinExtraId === ''
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
            nativeAmount: toNativeAmount
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

    if (quoteFor === 'from') {
      return await swapExchange(true)
    } else {
      return await swapExchange(false)
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

      await fetchSupportedAssets()

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

export function asOptionalBlank<T>(
  cleaner: Cleaner<T>
): Cleaner<T | undefined> {
  return function asIgnoredBlank(raw: any) {
    if (raw == null || raw === '') return undefined
    return cleaner(raw)
  }
}

interface XgramResponse {
  id: string
  fromAmount: string
  toAmount: string
  payinExtraId?: string
  payinAddress: string
  validUntil?: Date | null
}

const asXgramAssets = asArray(
  asObject({
    coinName: asString,
    network: asString,
    available: asBoolean,
    contract: asMaybe(asString, null)
  })
)

const asTemplateLimitError = asObject({
  code: asValue('BELOW_LIMIT', 'ABOVE_LIMIT'),
  destinationAmountLimit: asString,
  error: asString,
  sourceAmountLimit: asString
})

const asTemplateRegionError = asObject({
  code: asValue('REGION_UNSUPPORTED'),
  message: asString
})

const asTemplateCurrencyError = asObject({
  code: asValue('CURRENCY_UNSUPPORTED'),
  error: asString
})
const asTemplateError = asObject({
  errors: asArray(
    asEither(
      asTemplateLimitError,
      asTemplateRegionError,
      asTemplateCurrencyError
    )
  )
})
const asTemplateQuote = asObject({
  ccyAmountToExpected: asNumber,
  depositAddress: asString,
  depositTag: asString,
  id: asString,
  result: asBoolean
})
const asTemplateQuoteReply = asEither(asTemplateQuote, asTemplateError)
