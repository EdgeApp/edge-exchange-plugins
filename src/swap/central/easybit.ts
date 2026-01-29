import { gt, lt } from 'biggystring'
import {
  asArray,
  asBoolean,
  asEither,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapApproveOptions,
  EdgeSwapResult,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  ChainCodeTickerMap,
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  EdgeIdSwapIdMap,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
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

const pluginId = 'easybit'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'EasyBit',
  supportEmail: 'support@easybit.com'
}

const asInitOptions = asObject({
  apiKey: asString
})

const apiBase = 'https://api.easybit.com'
const orderUri = 'https://easybit.com/exchange/order/'

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

/**
 * Map Edge mainnet codes to EasyBit network tickers.
 * Fill in additional networks as EasyBit adds support.
 */
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'ALGO',
  arbitrum: 'ARBITRUM',
  avalanche: 'AVAXC',
  axelar: 'AXL',
  base: 'BASE',
  binance: 'BNB',
  binancesmartchain: 'BSC',
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  bitcoingold: null,
  bitcoinsv: null,
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
  ethereumpow: null,
  fantom: 'FTM',
  feathercoin: null,
  filecoin: 'FIL',
  filecoinfevm: null,
  fio: null,
  groestlcoin: null,
  hedera: 'HBAR',
  hyperevm: null,
  liberland: null,
  litecoin: 'LTC',
  monero: 'XMR',
  optimism: 'OPTIMISM',
  osmosis: 'OSMO',
  piratechain: 'ARRR',
  pivx: 'PIVX',
  polkadot: 'DOT',
  polygon: 'POLYGON',
  pulsechain: null,
  qtum: 'QTUM',
  ravencoin: 'RVN',
  ripple: 'XRP',
  rsk: null,
  smartcash: null,
  solana: 'SOL',
  sonic: 'SONIC',
  stellar: 'XLM',
  sui: 'SUI',
  telos: 'TELOS',
  tezos: 'XTZ',
  thorchainrune: 'RUNE',
  ton: 'TON',
  tron: 'TRX',
  ufo: null,
  vertcoin: null,
  wax: 'WAX',
  zano: 'ZANO',
  zcash: 'ZEC',
  zcoin: null,
  zksync: 'ZKSYNCERA'
} as CurrencyPluginIdSwapChainCodeMap

export const SPECIAL_MAINNET_CASES: EdgeIdSwapIdMap = new Map()

let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60

export function makeEasyBitPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'API-KEY': apiKey
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const response = await fetchCors(`${apiBase}/currencyList`, {
        method: 'GET',
        headers
      })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message)
      }
      const json = await response.json()
      const assets = asEasyBitAssets(json).data

      const out: ChainCodeTickerMap = new Map()
      for (const asset of assets) {
        for (const network of asset.networkList) {
          if (network.sendStatus === false) continue
          const tokenCodes = out.get(network.network) ?? []
          tokenCodes.push({
            tokenCode: asset.currency,
            contractAddress: network.contractAddress ?? null
          })
          out.set(network.network, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('EasyBit: Error updating supported assets', e)
    }
  }

  async function fetchPairInfo(params: {
    request: EdgeSwapRequestPlugin
    send: string
    receive: string
    sendNetwork: string
    receiveNetwork: string
    amount: string
  }): Promise<PairInfoData> {
    const { request, amount } = params
    const queryParams = new URLSearchParams({
      send: params.send,
      receive: params.receive,
      sendNetwork: params.sendNetwork,
      receiveNetwork: params.receiveNetwork
    })
    const url = `${apiBase}/pairInfo?${queryParams.toString()}`
    const response = await fetchCors(url, { method: 'GET', headers })
    if (!response.ok) {
      const message = await response.text()
      throw new Error(`EasyBit pairInfo returned error code ${response.status}: ${message}`)
    }
    const json = await response.json()
    const out = asPairInfoResponse(json)
    if (out.success !== 1) {
      throw new Error(out.errorMessage ?? 'EasyBit pairInfo error')
    }

    const pairInfo = out.data
    if (pairInfo.minimumAmount != null && lt(amount, pairInfo.minimumAmount)) {
      const minNativeAmount = denominationToNative(request.fromWallet, pairInfo.minimumAmount, request.fromTokenId)
      throw new SwapBelowLimitError(swapInfo, minNativeAmount)
    }

    if (pairInfo.maximumAmount != null && gt(amount, pairInfo.maximumAmount)) {
      const maxNativeAmount = denominationToNative(request.fromWallet, pairInfo.maximumAmount, request.fromTokenId)
      throw new SwapAboveLimitError(swapInfo, maxNativeAmount)
    }

    return pairInfo
  }

  async function getRate(params: {
    request: EdgeSwapRequestPlugin
    send: string
    receive: string
    sendNetwork: string
    receiveNetwork: string
    amount: string
    isFromQuote: boolean
  }): Promise<RateData> {
    const {
      request,
      send,
      receive,
      sendNetwork,
      receiveNetwork,
      amount,
      isFromQuote
    } = params

    const queryParams = new URLSearchParams({
      send,
      receive,
      sendNetwork,
      receiveNetwork,
      amount
    })

    if (!isFromQuote) {
      queryParams.set('amountType', 'receive')  // Reverse Quoting
    }

    const url = `${apiBase}/rate?${queryParams.toString()}`
    const response = await fetchCors(url, {
      method: 'GET',
      headers
    })

    if (!response.ok) {
      const message = await response.text()
      throw new SwapCurrencyError(swapInfo, request)
    }
    const json = await response.json()

    const rate = asRateResponse(json)
    if (rate.success !== 1) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    return rate.data as RateData
  }

  async function createOrder(params: {
    send: string
    receive: string
    sendNetwork: string
    receiveNetwork: string
    sendAmount: string
    receiveAddress: string
    refundAddress: string
  }): Promise<OrderData> {
    const orderBody = {
      send: params.send,
      receive: params.receive,
      sendNetwork: params.sendNetwork,
      receiveNetwork: params.receiveNetwork,
      amount: params.sendAmount,
      receiveAddress: params.receiveAddress,
      refundAddress: params.refundAddress,
      userDeviceId: `edge_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    }

    const response = await fetchCors(`${apiBase}/order`, {
      method: 'POST',
      headers,
      body: JSON.stringify(orderBody)
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `EasyBit order returned error code ${response.status}: ${text}`
      )
    }
    const json = await response.json()
    const order = asOrderResponse(json)
    if (order.success !== 1) {
      throw new Error(
        order.errorMessage != null
          ? `EasyBit order error: ${order.errorMessage}`
          : `EasyBit order error (status ${response.status})`
      )
    }
    return order.data
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const { nativeAmount, quoteFor } = request

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

    const codes = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION,
      SPECIAL_MAINNET_CASES
    )

    const amount =
      quoteFor === 'from'
        ? nativeToDenomination(
          request.fromWallet,
          nativeAmount,
          request.fromTokenId
        )
        : nativeToDenomination(
          request.toWallet,
          nativeAmount,
          request.toTokenId
        )

    const pairInfo = await fetchPairInfo({
      request,
      send: codes.fromCurrencyCode,
      receive: codes.toCurrencyCode,
      sendNetwork: codes.fromMainnetCode,
      receiveNetwork: codes.toMainnetCode,
      amount,
    })

    const rate = await getRate({
      request,
      send: codes.fromCurrencyCode,
      receive: codes.toCurrencyCode,
      sendNetwork: codes.fromMainnetCode,
      receiveNetwork: codes.toMainnetCode,
      amount,
      isFromQuote: quoteFor === 'from'
    })

    const sendAmount =
      quoteFor === 'from'
        ? amount
        : (() => {
          if (rate.sendAmount == null) {
            throw new Error('EasyBit: Missing sendAmount in reverse quote response')
          }
          return rate.sendAmount.toString()
        })()

    const sendNativeAmount = denominationToNative(
      request.fromWallet,
      sendAmount,
      request.fromTokenId
    )

    if (rate.receiveAmount == null) {
      throw new Error('Missing receiveAmount from rate response')
    }

    const toNativeAmount = denominationToNative(
      request.toWallet,
      rate.receiveAmount.toString(),
      request.toTokenId
    )

    const orderParams = {
      send: codes.fromCurrencyCode,
      receive: codes.toCurrencyCode,
      sendNetwork: codes.fromMainnetCode,
      receiveNetwork: codes.toMainnetCode,
      sendAmount,
      receiveAddress: toAddress,
      refundAddress: fromAddress
    }

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: sendNativeAmount,
          publicAddress: fromAddress
        }
      ],
      memos: [],
      networkFeeOption: 'high',
      assetAction: { assetActionType: 'swap' },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        orderId: '',
        orderUri: '',
        isEstimate: true,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: sendNativeAmount
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
      fromNativeAmount: sendNativeAmount,
      metadataNotes: JSON.stringify({ orderParams })
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
      const swapPluginQuote = await makeSwapPluginQuote(swapOrder)

      // Override approve() to create order before executing swap
      return {
        ...swapPluginQuote,
        async approve(approveOpts?: EdgeSwapApproveOptions): Promise<EdgeSwapResult> {
          const orderParamsStr = swapOrder.metadataNotes
          if (orderParamsStr == null) {
            throw new Error('EasyBit: Missing order parameters')
          }
          let orderParams
          try {
            const parsed = JSON.parse(orderParamsStr)
            orderParams = parsed.orderParams
          } catch (error) {
            throw new Error('EasyBit: Invalid order parameters format')
          }
          const order = await createOrder(orderParams)

          if (!('spendInfo' in swapOrder) || swapOrder.spendInfo.savedAction?.actionType !== 'swap') {
            throw new Error('EasyBit: Invalid swap order structure')
          }
          const { toAsset, fromAsset } = swapOrder.spendInfo.savedAction

          const tx = await request.fromWallet.makeSpend({
            tokenId: request.fromTokenId,
            spendTargets: [
              {
                nativeAmount: swapOrder.fromNativeAmount,
                publicAddress: order.sendAddress
              }
            ],
            memos:
              order.sendTag == null
                ? []
                : [
                  {
                    type: memoType(request.fromWallet.currencyInfo.pluginId),
                    value: order.sendTag
                  }
                ],
            networkFeeOption: 'high',
            assetAction: { assetActionType: 'swap' },
            savedAction: {
              actionType: 'swap',
              swapInfo,
              orderId: order.id,
              orderUri: orderUri + order.id,
              isEstimate: true,
              toAsset,
              fromAsset,
              payoutAddress: orderParams.receiveAddress,
              payoutWalletId: request.toWallet.id,
              refundAddress: orderParams.refundAddress
            }
          })

          const signedTx = await request.fromWallet.signTx(tx)
          const broadcastedTx = await request.fromWallet.broadcastTx(signedTx)
          await request.fromWallet.saveTx(signedTx)

          return {
            transaction: broadcastedTx,
            orderId: order.id,
            destinationAddress: orderParams.receiveAddress
          }
        }
      }
    }
  }

  return out
}

const asEasyBitNetwork = asObject({
  network: asString,
  sendStatus: asOptional(asBoolean, true),
  contractAddress: asOptional(asString)
})

const asEasyBitAsset = asObject({
  currency: asString,
  networkList: asArray(asEasyBitNetwork)
})

const asEasyBitAssets = asObject({
  success: asNumber,
  data: asArray(asEasyBitAsset)
})

const asStringOrNumber = (raw: any): number => {
  const value = asEither(asString, asNumber)(raw)
  return typeof value === 'string' ? Number(value) : value
}

const asRateData = asObject({
  rate: asOptional(asStringOrNumber),
  minimumAmount: asOptional(asString),
  maximumAmount: asOptional(asString),
  sendAmount: asOptional(asString),
  receiveAmount: asOptional(asString),
})
type RateData = ReturnType<typeof asRateData>

const asRateResponse = asObject({
  success: asNumber,
  errorCode: asOptional(asNumber),
  errorMessage: asOptional(asString),
  data: asRateData
})

const asOrderData = asObject({
  id: asString,
  sendAddress: asString,
  sendTag: asOptional(asString),
  refundAddress: asOptional(asString),
  receiveAmount: asOptional(asString),
  sendAmount: asOptional(asString)
})
type OrderData = ReturnType<typeof asOrderData>

const asOrderResponse = asObject({
  success: asNumber,
  errorMessage: asOptional(asString),
  data: asOrderData
})

const asPairInfoData = asObject({
  minimumAmount: asOptional(asString),
  maximumAmount: asOptional(asString),
  networkFee: asOptional(asString),
  confirmations: asOptional(asNumber),
  processingTime: asOptional(asString)
})
type PairInfoData = ReturnType<typeof asPairInfoData>

const asPairInfoResponse = asObject({
  success: asNumber,
  errorMessage: asOptional(asString),
  data: asPairInfoData
})