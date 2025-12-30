import { gt, lt } from 'biggystring'
import { asNumber, asObject, asOptional, asString, Cleaner } from 'cleaners'
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

import {
  ChainCodeTickerMap,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  ensureInFuture,
  getChainAndTokenCodes,
  getMaxSwappable,
  makeSwapPluginQuote,
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

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'ALGO',
  arbitrum: 'ARB',
  avalanche: 'AVAX',
  axelar: 'WAXL',
  base: null,
  binance: 'BNB',
  binancesmartchain: null,
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  bitcoingold: 'BTG',
  bitcoinsv: 'BSV',
  bobevm: null,
  cardano: 'ADA',
  celo: 'CELO',
  coreum: null,
  cosmoshub: 'ATOM',
  dash: 'DASH',
  digibyte: 'DGB',
  dogecoin: 'DOGE',
  eboost: null,
  ecash: 'XEC',
  eos: 'EOS',
  ethereum: 'ETH',
  ethereumclassic: 'ETC',
  ethereumpow: 'ETHW',
  fantom: 'FTM',
  feathercoin: null,
  filecoin: 'FIL',
  filecoinfevm: null,
  fio: 'FIO',
  groestlcoin: null,
  hedera: 'HBAR',
  liberland: null,
  litecoin: 'LTC',
  monero: 'XMR',
  optimism: 'OP',
  osmosis: 'OSMO',
  piratechain: null,
  pivx: 'PIVX',
  polkadot: 'DOT',
  polygon: 'MATIC',
  pulsechain: null,
  qtum: 'QTUM',
  ravencoin: 'RVN',
  ripple: 'XRP',
  rsk: null,
  smartcash: null,
  solana: 'SOL',
  stellar: 'XLM',
  sui: 'SUI',
  telos: null,
  tezos: 'XTZ',
  thorchainrune: null,
  ton: 'TON',
  tron: 'TRX',
  ufo: null,
  vertcoin: null,
  wax: 'WAXP',
  zano: null,
  zcash: 'Zcash',
  zcoin: 'FIRO',
  zksync: null,
  hyperevm: null,
  sonic: null,
  abstract: null,
  amoy: null,
  badcoin: null,
  bitcoincashtestnet: null,
  bitcoingoldtestnet: null,
  bitcointestnet: null,
  bitcointestnet4: null,
  botanix: null,
  calibration: null,
  cardanotestnet: null,
  ethDev: null,
  filecoinfevmcalibration: null,
  holesky: null,
  liberlandtestnet: null,
  sepolia: null,
  suitestnet: null,
  thorchainrunestagenet: null
}

const chainCodeTickerMap: ChainCodeTickerMap = new Map()

const swapType: FlowType = 'fixed'
type FlowType = 'fixed' | 'float'

export function xgramPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
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
        fromNetwork: xgramCodes.fromMainnetCode,
        toNetwork: xgramCodes.toMainnetCode,
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

      if (orderResponseJson.result !== true) {
        const denomAmount = denominationToNative(
          quoteFor === 'from' ? request.fromWallet : request.toWallet,
          largeDenomAmount,
          quoteFor === 'from' ? request.fromTokenId : request.toTokenId
        )
        if (orderResponseJson.error === 'Min amount error') {
          throw new SwapBelowLimitError(swapInfo, denomAmount, quoteFor)
        }
        if (orderResponseJson.error === 'Max amount error') {
          throw new SwapAboveLimitError(swapInfo, denomAmount, quoteFor)
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
      const buyUrl = `fromCcy=${xgramCodes.toCurrencyCode}&toCcy=${xgramCodes.fromMainnetCode}`
      const sellUrl = `fromCcy=${xgramCodes.fromMainnetCode}&toCcy=${xgramCodes.toCurrencyCode}`
      const getRateUrl = isSelling ? sellUrl : buyUrl

      const largeDenomAmount = nativeToDenomination(
        isSelling ? request.fromWallet : request.toWallet,
        nativeAmount,
        isSelling ? request.fromTokenId : request.toTokenId
      )

      const rateQs = `retrieve-rate-value?ccyAmount=${largeDenomAmount}&${getRateUrl}&type=${swapType}`
      const marketRangeResponse = await fetchCors(uri + rateQs, { headers })

      if (!marketRangeResponse.ok) {
        throw new Error('Xgram retrieve-rate-value failed')
      }
      const marketRangeResponseJson: {
        result: boolean
        error?: string
      } = await marketRangeResponse.json()

      // Below/Above limits errors
      // Unsupported currency error
      if (!marketRangeResponseJson.result) {
        const { minFromCcyAmount, maxFromCcyAmount } = asMarketRange(
          marketRangeResponseJson
        )
        const minFrom = minFromCcyAmount.toString()
        const maxFrom = maxFromCcyAmount.toString()

        if (marketRangeResponseJson.error === 'Pair not found') {
          throw new SwapCurrencyError(swapInfo, request)
        }

        if (lt(largeDenomAmount, minFrom)) {
          const minNativeAmount = denominationToNative(
            isSelling ? request.fromWallet : request.toWallet,
            minFrom,
            isSelling ? request.fromTokenId : request.toTokenId
          )
          throw new SwapBelowLimitError(
            swapInfo,
            minNativeAmount,
            isSelling ? undefined : 'to'
          )
        }

        if (gt(largeDenomAmount, maxFrom)) {
          const maxNativeAmount = denominationToNative(
            isSelling ? request.fromWallet : request.toWallet,
            maxFrom,
            isSelling ? request.fromTokenId : request.toTokenId
          )
          throw new SwapAboveLimitError(
            swapInfo,
            maxNativeAmount,
            isSelling ? undefined : 'to'
          )
        }
      }
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

export function asOptionalBlank<T>(
  cleaner: Cleaner<T>
): Cleaner<T | undefined> {
  return function asIgnoredBlank(raw: any) {
    if (raw == null || raw === '') return undefined
    return cleaner(raw)
  }
}

const asMarketRange = asObject({
  maxFromCcyAmount: asNumber,
  minFromCcyAmount: asNumber
})

interface XgramResponse {
  id: string
  fromAmount: string
  toAmount: string
  payinExtraId?: string
  payinAddress: string
  validUntil?: Date | null
}
