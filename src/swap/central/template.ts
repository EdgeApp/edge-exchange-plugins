import {
  asArray,
  asDate,
  asEither,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
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

import { template as templateMapping } from '../../mappings/template'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  ensureInFuture,
  getContractAddresses,
  makeSwapPluginQuote,
  mapToRecord,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { asNumberString } from '../types'

const pluginId = 'template'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'TemplateSwap',
  supportEmail: 'support@example.com'
}

const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString)
})

const orderUri = 'https://example.com/?orderId='
// TODO: Replace with actual API base URL
const apiBaseUrl = 'https://api.example.com/api/v1/'

const asTemplateLimitError = asObject({
  code: asValue('BELOW_LIMIT', 'ABOVE_LIMIT'),
  message: asString,
  sourceLimitAmount: asNumberString,
  destinationLimitAmount: asNumberString
})

const asTemplateRegionError = asObject({
  code: asValue('REGION_UNSUPPORTED'),
  message: asString
})

const asTemplateCurrencyError = asObject({
  code: asValue('CURRENCY_UNSUPPORTED'),
  message: asString
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
  sourceAmount: asNumberString,
  destinationAmount: asNumberString,
  depositAddress: asString,
  depositExtraId: asOptional(asString),
  orderId: asString,
  /** API should return an ISO 8601 formatted date */
  expirationIsoDate: asDate
})

const asTemplateQuoteReply = asEither(asTemplateQuote, asTemplateError)

interface TemplateCommonQuoteParams {
  fromNetwork: string
  toNetwork: string
  fromContractAddress?: string
  toContractAddress?: string
  fromEvmChainId?: number
  toEvmChainId?: number
  refundAddress: string
  destinationAddress: string
}

type TemplateMaxQuoteParams = TemplateCommonQuoteParams & {
  maxAmount: boolean
}

type TemplateFromQuoteParams = TemplateCommonQuoteParams & {
  sourceAmount: string
}

type TemplateToQuoteParams = TemplateCommonQuoteParams & {
  destinationAmount: string
}

type TemplateQuoteParams =
  | TemplateFromQuoteParams
  | TemplateToQuoteParams
  | TemplateMaxQuoteParams

const EVM_CHAIN_NETWORK = 'evmChain'

const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  templateMapping
)

/**
 * Get the network identifier for a wallet. If the wallet is an EVM chain,
 * returns 'evmChain'. Otherwise, uses the mainnet code transcription.
 */
const getNetwork = (wallet: EdgeCurrencyWallet): string | null => {
  const evmChainId = wallet.currencyInfo.evmChainId
  if (evmChainId != null) return EVM_CHAIN_NETWORK
  return MAINNET_CODE_TRANSCRIPTION[
    wallet.currencyInfo.pluginId as EdgeCurrencyPluginId
  ]
}

export function makeTemplatePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const initOptions = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${initOptions.apiKey}`,
    Accept: 'application/json'
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequest
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor } = request

    const fromNetwork = getNetwork(fromWallet)
    const toNetwork = getNetwork(toWallet)

    if (fromNetwork == null || toNetwork == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromEvmChainId = fromWallet.currencyInfo.evmChainId
    const toEvmChainId = toWallet.currencyInfo.evmChainId

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet),
      getAddress(toWallet)
    ])

    // Convert the native amount to a denomination:
    let amount
    if (quoteFor === 'from') {
      const quoteAmount = nativeToDenomination(
        request.fromWallet,
        request.nativeAmount,
        request.fromTokenId
      )
      amount = { sourceAmount: quoteAmount }
    } else if (quoteFor === 'to') {
      const quoteAmount = nativeToDenomination(
        request.toWallet,
        request.nativeAmount,
        request.toTokenId
      )
      amount = { destinationAmount: quoteAmount }
    } else {
      amount = { maxAmount: true }
    }

    const { fromContractAddress, toContractAddress } = getContractAddresses(
      request
    )

    const quoteParams: TemplateQuoteParams = {
      fromNetwork,
      toNetwork,
      fromContractAddress,
      toContractAddress,
      fromEvmChainId,
      toEvmChainId,
      refundAddress: fromAddress,
      destinationAddress: toAddress,
      ...amount
    }
    log('quoteParams:', quoteParams)

    const response = await io.fetch(apiBaseUrl + 'getQuote', {
      headers,
      method: 'POST',
      body: JSON.stringify(quoteParams)
    })
    if (!response.ok) {
      const text = await response.text()
      log.warn('Template API error response:', text)
      throw new Error(`Template returned error code ${response.status}`)
    }
    const responseJson = await response.json()

    let quoteReply
    try {
      quoteReply = asTemplateQuoteReply(responseJson)
    } catch (error) {
      log.warn(
        'Unexpected Template API response:',
        JSON.stringify(responseJson)
      )
      throw error
    }

    if ('errors' in quoteReply) {
      // Throw errors in order of highest priority
      // 1. Region unsupported
      // 2. Currency unsupported
      // 3. Below/Above limit
      const errors = quoteReply.errors
      if (errors.find(error => error.code === 'REGION_UNSUPPORTED') != null) {
        throw new SwapPermissionError(swapInfo, 'geoRestriction')
      }
      if (errors.find(error => error.code === 'CURRENCY_UNSUPPORTED') != null) {
        throw new SwapCurrencyError(swapInfo, request)
      }
      const limitError = errors.find(
        error => error.code === 'BELOW_LIMIT' || error.code === 'ABOVE_LIMIT'
      )
      if (limitError != null && 'sourceLimitAmount' in limitError) {
        if (quoteFor === 'max') {
          throw new Error(
            `Max quote cannot return a limit error: ${JSON.stringify(
              limitError
            )}`
          )
        }
        let nativeMinMaxAmount: string
        if (quoteFor === 'from') {
          nativeMinMaxAmount = denominationToNative(
            request.fromWallet,
            limitError.sourceLimitAmount,
            request.fromTokenId
          )
        } else {
          nativeMinMaxAmount = denominationToNative(
            request.toWallet,
            limitError.destinationLimitAmount,
            request.toTokenId
          )
        }

        if (limitError.code === 'BELOW_LIMIT') {
          throw new SwapBelowLimitError(swapInfo, nativeMinMaxAmount, quoteFor)
        } else {
          throw new SwapAboveLimitError(swapInfo, nativeMinMaxAmount, quoteFor)
        }
      }
      throw new Error(
        `Unknown error type: ${JSON.stringify(quoteReply.errors)}`
      )
    }

    const fromNativeAmount = denominationToNative(
      fromWallet,
      quoteReply.sourceAmount,
      request.fromTokenId
    )
    const toNativeAmount = denominationToNative(
      toWallet,
      quoteReply.destinationAmount,
      request.toTokenId
    )
    const memos: EdgeMemo[] =
      quoteReply.depositExtraId == null
        ? []
        : [
            {
              type: memoType(request.fromWallet.currencyInfo.pluginId),
              value: quoteReply.depositExtraId
            }
          ]

    // Make the transaction:
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteReply.depositAddress
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
        orderId: quoteReply.orderId,
        orderUri: orderUri + quoteReply.orderId,
        isEstimate: false,
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

    log('spendInfo', spendInfo)

    const requestPlugin = convertRequest(request)

    return {
      request: requestPlugin,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: ensureInFuture(quoteReply.expirationIsoDate)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const swapOrder = await fetchSwapQuoteInner(request)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
