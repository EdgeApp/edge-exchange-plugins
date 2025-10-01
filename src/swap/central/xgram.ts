import { gt, lt } from 'biggystring'
import { asArray, asBoolean, asObject, asString, Cleaner } from 'cleaners'
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
  checkInvalidCodes,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  EdgeIdSwapIdMap,
  ensureInFuture,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
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
  apiKey: asString
})

const orderUri = 'https://xgram.io/exchange/order?id='

const uri = 'https://xgram.io/api/v1/'
const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {}
}

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

export const SPECIAL_MAINNET_CASES: EdgeIdSwapIdMap = new Map([
  ['avalanche', new Map([[null, { chainCode: 'cchain', tokenCode: 'avax' }]])]
])

// Provider data
let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60

const swapFix = 'float'
const swapFloat = 'float'
type FlowType = 'fixed' | 'float'

export function xgramPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const response = await fetchCors(`${uri}list-currency-options`, {
        headers
      })
      const json = await response.json()

      if (json.result !== true) {
        throw new Error('Xgram call list currency error')
      }

      const jsonArr = Object.entries(json).map(([symbol, data]) => ({
        ...(data as object)
      }))
      const assets = asXgramAssets(jsonArr)

      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
      const out: ChainCodeTickerMap = new Map()
      for (const asset of assets) {
        if (chaincodeArray.includes(asset.coinName)) {
          const tokenCodes = out.get(asset.coinName) ?? []
          tokenCodes.push({
            tokenCode: asset.coinName,
            contractAddress: null // TODO check this val
          })
          out.set(asset.network, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('-----> Xgram: Error updating supported assets', e)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
    // opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const { nativeAmount } = request

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet),
      getAddress(request.toWallet)
    ])

    const xgramCodes = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION,
      SPECIAL_MAINNET_CASES
    )

    const currencyString = `fromCcy=${xgramCodes.fromMainnetCode}&toCcy=${xgramCodes.toCurrencyCode}`

    async function createOrder(
      flow: FlowType,
      isSelling: boolean,
      largeDenomAmount: string
    ): Promise<XgramResponse> {
      // Get rate
      let url = `retrieve-rate-value?ccyAmount=${largeDenomAmount}&${currencyString}`
      if (!isSelling) {
        const currencySellString = `toCcy=${xgramCodes.fromMainnetCode}&fromCcy=${xgramCodes.toCurrencyCode}`
        url = `retrieve-rate-value?ccyAmount=${largeDenomAmount}&${currencySellString}`
      }

      const exchangeAmountResponse = await fetchCors(uri + url, { headers })
      const exchangeAmountResponseJson = await exchangeAmountResponse.json()

      if (exchangeAmountResponseJson.result !== true)
        throw new SwapCurrencyError(swapInfo, request)

      const validUntil = null

      // Create order
      const fromCcy = {
        fromCurrency: xgramCodes.fromCurrencyCode,
        toCurrency: xgramCodes.toCurrencyCode,
        fromNetwork: xgramCodes.fromMainnetCode,
        toNetwork: xgramCodes.toMainnetCode,
        fromAmount: isSelling ? largeDenomAmount : '',
        toAmount: isSelling ? '' : largeDenomAmount,
        address: toAddress,
        refundAddress: fromAddress,
        flow
        // payload: { promoCode }
      }

      const orderResponse = await fetchCors(
        uri +
          'launch-new-exchange' +
          `?${new URLSearchParams({
            toAddress: String(toAddress),
            refundAddress: String(fromAddress),
            fromCcy: fromCcy.fromCurrency,
            toCcy: fromCcy.toCurrency,
            ccyAmount: largeDenomAmount
          }).toString()}`,
        {
          headers
        }
      )

      const orderResponseJson = await orderResponse.json()

      if (orderResponseJson.result !== true) {
        const errMsg = String(orderResponseJson.error ?? '')
        throw new Error(`Xgram call returned error message: ${errMsg}`)
      }

      const orderRes = {
        id: orderResponseJson.id,
        validUntil,
        toAmount: fromCcy.toAmount,
        fromAmount: fromCcy.fromAmount,
        payinAddress: orderResponseJson.depositAddress,
        payinExtraId: orderResponseJson.depositTag
      }

      return orderRes
    }

    async function swapSell(flow: FlowType): Promise<SwapOrder> {
      const largeDenomAmount = await request.fromWallet.nativeToDenomination(
        nativeAmount,
        request.fromCurrencyCode
      )

      // Get min and max
      const marketRangeResponse = await fetchCors(
        uri +
          `retrieve-rate-value?ccyAmount=${largeDenomAmount}&${currencyString}`,
        { headers }
      )

      const marketRangeResponseJson = await marketRangeResponse.json()

      if (marketRangeResponseJson.result !== true)
        throw new SwapCurrencyError(swapInfo, request)

      const { minFrom, maxFrom } = asMarketRange(marketRangeResponseJson)
      if (lt(largeDenomAmount, minFrom)) {
        const minNativeAmount = await request.fromWallet.denominationToNative(
          minFrom.toString(),
          request.fromCurrencyCode
        )
        throw new SwapBelowLimitError(swapInfo, minNativeAmount)
      }

      if (maxFrom != null && gt(largeDenomAmount, maxFrom)) {
        const maxNativeAmount = await request.fromWallet.denominationToNative(
          maxFrom,
          request.fromCurrencyCode
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

      const toNativeAmount = await request.toWallet.denominationToNative(
        toAmount.toString(),
        request.toCurrencyCode
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
          isEstimate: flow === swapFloat,
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
    async function swapBuy(flow: typeof swapFix): Promise<SwapOrder> {
      const largeDenomAmount = await request.toWallet.nativeToDenomination(
        nativeAmount,
        request.toCurrencyCode
      )

      const {
        fromAmount,
        payinAddress,
        payinExtraId,
        id,
        validUntil
      } = await createOrder(flow, false, largeDenomAmount)

      const fromNativeAmount = await request.fromWallet.denominationToNative(
        fromAmount.toString(),
        request.fromCurrencyCode
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

    if (quoteFor === 'from') {
      return await swapSell(swapFix)
    } else {
      return await swapBuy(swapFix)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      req: EdgeSwapRequest
      // opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      await fetchSupportedAssets()

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(
        fetchSwapQuoteInner,
        request
        // opts
      )
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
    available: asBoolean
  })
)
