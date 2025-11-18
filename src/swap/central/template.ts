import {
  asArray,
  asBoolean,
  asDate,
  asEither,
  asObject,
  asOptional,
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

import {
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  EdgeCurrencyPluginId,
  getContractAddresses,
  makeSwapPluginQuote,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin } from '../types'

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
const uri = 'https://api.example.com/api/v1/'

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
  message: asString,
  sourceCurrencyUnsupported: asBoolean,
  destinationCurrencyUnsupported: asBoolean
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
  sourceNetwork: asString,
  destinationNetwork: asString,
  sourceContractAddress: asOptional(asString),
  destinationContractAddress: asOptional(asString),
  depositAddress: asString,
  depositExtraId: asOptional(asString),
  orderId: asString,
  /** API should return an ISO formatted date */
  expirationIsoDate: asDate
})

const asTemplateQuoteReply = asEither(asTemplateQuote, asTemplateError)

interface TemplateCommonQuoteParams {
  fromNetwork: string
  toNetwork: string
  fromContractAddress: string
  toContractAddress: string
  refundAddress: string
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

// See https://example.com/exchange-pairs for list of supported currencies
// Or `curl -X GET 'https://api.example.com/api/v2/coins' -H 'Authorization: Bearer <your-api-key>' | jq .`
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'ALGO',
  arbitrum: 'ARBITRUM',
  avalanche: 'AVAXC',
  axelar: 'WAXL',
  base: null,
  binance: 'BEP2',
  binancesmartchain: 'BEP20',
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  bitcoingold: 'BTG',
  bitcoinsv: 'BSV',
  bobevm: null,
  cardano: 'ADA',
  celo: 'CELO',
  coreum: 'COREUM',
  cosmoshub: 'ATOM',
  dash: 'DASH',
  digibyte: 'DGB',
  dogecoin: 'DOGE',
  eboost: null,
  ecash: 'XEC',
  eos: 'EOS',
  ethereum: 'ERC20',
  ethereumclassic: 'ETC',
  ethereumpow: 'ETHW',
  fantom: 'FTM',
  feathercoin: null,
  filecoin: 'FIL',
  filecoinfevm: null,
  fio: 'FIO',
  groestlcoin: 'GRS',
  hedera: 'HBAR',
  hyperevm: 'HYPE',
  liberland: null,
  litecoin: 'LTC',
  monero: 'XMR',
  optimism: 'OPTIMISM',
  osmosis: 'OSMO',
  piratechain: 'ARRR',
  pivx: 'PIVX',
  polkadot: 'DOT',
  polygon: 'POL',
  pulsechain: 'PLS',
  qtum: 'QTUM',
  ravencoin: 'RVN',
  ripple: 'XRP',
  rsk: 'RSK',
  smartcash: null,
  solana: 'SOL',
  sonic: 'SONIC',
  stellar: 'XLM',
  sui: 'SUI',
  telos: 'TLOS',
  tezos: 'XTZ',
  thorchainrune: 'RUNE',
  ton: 'TON',
  tron: 'TRC20',
  ufo: null,
  vertcoin: null,
  wax: 'WAX',
  zano: null, // 'ZANO' disabled until until it can be tested for integrated address/payment id
  zcash: 'ZEC',
  zcoin: 'FIRO',
  zksync: 'ZKSERA'
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
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor } = request

    const fromNetwork =
      MAINNET_CODE_TRANSCRIPTION[
        fromWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
      ]
    const toNetwork =
      MAINNET_CODE_TRANSCRIPTION[
        toWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
      ]

    if (fromNetwork == null || toNetwork == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

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
      refundAddress: fromAddress,
      ...amount
    }
    log('quoteParams:', quoteParams)

    const response = await io.fetch(uri + 'getQuote', {
      headers,
      method: 'POST',
      body: JSON.stringify(quoteParams)
    })
    const responseJson = await response.json()
    const quoteReply = asTemplateQuoteReply(responseJson)

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
          throw new Error('Max quote cannot return a limit error')
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
      throw new Error('Unknown error type')
    } else {
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

      return {
        request,
        spendInfo,
        swapInfo,
        fromNativeAmount,
        expirationDate: quoteReply.expirationIsoDate
      }
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const requestPlugin = convertRequest(request)

      const swapOrder = await fetchSwapQuoteInner(requestPlugin, opts)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
