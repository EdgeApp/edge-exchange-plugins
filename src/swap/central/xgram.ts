import {
  asArray,
  asBoolean,
  asDate,
  asEither,
  asMaybe,
  asNumber,
  asObject,
  asString,
  asValue
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
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getContractAddresses,
  getMaxSwappable,
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
import { asOptionalBlank } from './changenow'

const pluginId = 'xgram'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Xgram',
  supportEmail: 'support@xgram.io'
}

const asInitOptions = asObject({
  apiKey: asString
})

const orderUri = 'https://xgram.io/exchange/order?id='
const uri = 'https://xgram.io/api/v2/'
const newExchange = 'launch-new-exchange-edge'
const newRevExchange = 'launch-new-payment-exchange-edge'

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  xgramMapping
)

const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

const swapType = 'fixed' as const

export function makeXgramPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io } = opts

  const fetchCors = io.fetch
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, nativeAmount } = request

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

    const { fromContractAddress, toContractAddress } = getContractAddresses(
      request
    )

    const fromNetwork =
      MAINNET_CODE_TRANSCRIPTION[
        fromWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
      ] ?? ''
    const toNetwork =
      MAINNET_CODE_TRANSCRIPTION[
        toWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
      ] ?? ''

    async function createOrder(
      isSelling: boolean,
      largeDenomAmount: string
    ): Promise<XgramResponse> {
      const createExchangeUrl = isSelling ? newExchange : newRevExchange

      const qs = new URLSearchParams({
        toAddress: String(toAddress),
        refundAddress: String(fromAddress),
        ccyAmount: largeDenomAmount,
        type: swapType,
        fromContractAddress: fromContractAddress ?? '',
        toContractAddress: toContractAddress ?? '',
        fromNetwork,
        toNetwork
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
      const quoteFor = request.quoteFor === 'from' ? 'from' : 'to'
      const quoteReply = asXgramQuoteReply(orderResponseJson)

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
        const limitError = errors
          .map(e => asMaybe(asXgramLimitError)(e))
          .find(e => e != null)

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

      return {
        id: quoteReply.id,
        validUntil: quoteReply.expiresAt,
        fromAmount: quoteReply.ccyAmountFrom,
        toAmount: quoteReply.ccyAmountToExpected.toString(),
        payinAddress: quoteReply.depositAddress,
        payinExtraId: quoteReply.depositTag
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

interface XgramResponse {
  id: string
  fromAmount: string
  toAmount: string
  payinExtraId?: string
  payinAddress: string
  validUntil?: Date | null
}

const asXgramLimitError = asObject({
  code: asValue('BELOW_LIMIT', 'ABOVE_LIMIT'),
  destinationAmountLimit: asString,
  error: asString,
  sourceAmountLimit: asString
})

const asXgramRegionError = asObject({
  code: asValue('REGION_UNSUPPORTED'),
  message: asString
})

const asXgramCurrencyError = asObject({
  code: asValue('CURRENCY_UNSUPPORTED'),
  error: asString
})
const asXgramError = asObject({
  errors: asArray(
    asEither(asXgramLimitError, asXgramRegionError, asXgramCurrencyError)
  )
})
const asXgramQuote = asObject({
  ccyAmountToExpected: asNumber,
  depositAddress: asString,
  depositTag: asOptionalBlank(asString),
  id: asString,
  result: asBoolean,
  expiresAt: asDate,
  ccyAmountFrom: asString
})
const asXgramQuoteReply = asEither(asXgramQuote, asXgramError)
