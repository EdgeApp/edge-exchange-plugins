import { gt, lt } from 'biggystring'
import {
  asArray,
  asBoolean,
  asMaybe,
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
  SwapBelowLimitError
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
  sonic: null
}

// Provider data
let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60

const swapType: FlowType = 'fixed'
type FlowType = 'fixed' | 'float'

export function xgramPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
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
      const out: ChainCodeTickerMap = new Map()
      for (const asset of assets) {
        if (chaincodeArray.includes(asset.coinName)) {
          const tokenCodes = out.get(asset.coinName) ?? []
          tokenCodes.push({
            tokenCode: asset.coinName,
            contractAddress: asset.contract
          })
          out.set(asset.network, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('Xgram: Error updating supported assets', e)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, nativeAmount } = request

    // Grab addresses:
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
      const validUntil = null
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

      const orderResponse = await fetchCors(
        uri +
          createExchangeUrl +
          `?${new URLSearchParams({
            toAddress: String(toAddress),
            refundAddress: String(fromAddress),
            fromCcy: orderBody.fromCurrency,
            toCcy: orderBody.toCurrency,
            ccyAmount: largeDenomAmount,
            type: swapType
          }).toString()}`,
        {
          headers
        }
      )

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
      }

      const orderRes = {
        id: orderResponseJson.id,
        validUntil,
        fromAmount: isSelling
          ? orderBody.fromAmount
          : orderResponseJson.ccyAmountFrom,
        toAmount: isSelling
          ? orderResponseJson.ccyAmountToExpected
          : orderBody.toAmount,
        payinAddress: orderResponseJson.depositAddress,
        payinExtraId: orderResponseJson.depositTag
      }
      return orderRes
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
      // Get min and max
      const marketRangeResponse = await fetchCors(
        uri +
          `retrieve-rate-value?ccyAmount=${largeDenomAmount}&${getRateUrl}&type=${swapType}`,
        { headers }
      )
      const marketRangeResponseJson = await marketRangeResponse.json()

      const { minFrom, maxFrom } = asMarketRange(marketRangeResponseJson)

      if (lt(largeDenomAmount, minFrom)) {
        const minNativeAmount = denominationToNative(
          isSelling ? request.fromWallet : request.toWallet,
          minFrom,
          isSelling ? request.fromTokenId : request.toTokenId
        )
        if (isSelling) {
          throw new SwapBelowLimitError(swapInfo, minNativeAmount)
        } else {
          throw new SwapBelowLimitError(swapInfo, minNativeAmount, 'to')
        }
      }

      if (gt(largeDenomAmount, maxFrom)) {
        const maxNativeAmount = denominationToNative(
          isSelling ? request.fromWallet : request.toWallet,
          maxFrom,
          isSelling ? request.fromTokenId : request.toTokenId
        )
        if (isSelling) {
          throw new SwapAboveLimitError(swapInfo, maxNativeAmount)
        } else {
          throw new SwapAboveLimitError(swapInfo, maxNativeAmount, 'to')
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

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      await fetchSupportedAssets()

      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(fetchSwapQuoteInner, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

/**
 * An optional value, where a blank string means undefined.
 */
export function asOptionalBlank<T>(
  cleaner: (raw: null | string) => T
): Cleaner<T | undefined> {
  return function asIgnoredBlank(raw) {
    if (raw == null || raw === '') return
    return cleaner(raw)
  }
}

const asMarketRange = asObject({
  maxFrom: asString,
  minFrom: asString
})

const asOrder = asObject({
  fromAmount: asString,
  toAmount: asString,
  payinExtraId: asOptionalBlank(asString),
  id: asString,
  payinAddress: asString
})

type XgramResponse = ReturnType<typeof asOrder> & { validUntil?: Date | null }

const asXgramAssets = asArray(
  asObject({
    coinName: asString,
    network: asString,
    available: asBoolean,
    contract: asMaybe(asString, null)
  })
)
