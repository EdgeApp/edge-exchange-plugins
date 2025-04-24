import {
  asArray,
  asBoolean,
  asEither,
  asMaybe,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeFetchFunction,
  EdgeLog,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  JsonObject,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import {
  ChainCodeTickerMap,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getChainAndTokenCodes,
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'

// See https://help.sideshift.ai/en/articles/4559664-which-coins-and-tokens-are-listed for list of supported currencies
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'algorand',
  arbitrum: 'arbitrum',
  avalanche: 'avax',
  axelar: null,
  base: 'base',
  binance: null,
  binancesmartchain: 'bsc',
  bitcoin: 'bitcoin',
  bitcoincash: 'bitcoincash',
  bitcoingold: null,
  bitcoinsv: 'bsv',
  bobevm: null,
  cardano: 'cardano',
  celo: null,
  coreum: null,
  cosmoshub: 'cosmos',
  dash: 'dash',
  digibyte: null,
  dogecoin: 'doge',
  eboost: null,
  eos: null,
  ethereum: 'ethereum',
  ethereumclassic: 'etc',
  ethereumpow: null,
  fantom: 'fantom',
  feathercoin: null,
  filecoin: null,
  filecoinfevm: null,
  fio: null,
  groestlcoin: 'grs',
  hedera: null,
  liberland: null,
  litecoin: 'litecoin',
  monero: 'monero',
  optimism: 'optimism',
  osmosis: null,
  piratechain: null,
  pivx: null,
  polkadot: 'polkadot',
  polygon: 'polygon',
  pulsechain: null,
  qtum: null,
  ravencoin: null,
  ripple: 'ripple',
  rsk: 'rootstock',
  smartcash: null,
  solana: 'solana',
  stellar: 'stellar',
  sui: 'sui',
  telos: null,
  tezos: 'tezos',
  thorchainrune: null,
  ton: 'ton',
  tron: 'tron',
  ufo: null,
  vertcoin: null,
  wax: null,
  zano: null,
  zcash: 'shielded',
  zcoin: null,
  zksync: 'zksyncera'
}

const SIDESHIFT_BASE_URL = 'https://sideshift.ai/api/v2'
const pluginId = 'sideshift'
export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'SideShift.ai',
  supportEmail: 'help@sideshift.ai'
}
const ORDER_STATUS_URL = 'https://sideshift.ai/orders/'

async function checkQuoteError(
  rate: Rate,
  request: EdgeSwapRequestPlugin,
  quoteErrorMessage: string
): Promise<void> {
  const { fromWallet } = request

  if (quoteErrorMessage === 'Amount too low') {
    const nativeMin = await fromWallet.denominationToNative(
      rate.min,
      request.fromCurrencyCode
    )
    throw new SwapBelowLimitError(swapInfo, nativeMin)
  }

  if (quoteErrorMessage === 'Amount too high') {
    const nativeMax = await fromWallet.denominationToNative(
      rate.max,
      request.fromCurrencyCode
    )
    throw new SwapAboveLimitError(swapInfo, nativeMax)
  }

  if (
    /method/i.test(quoteErrorMessage) &&
    /disabled/i.test(quoteErrorMessage)
  ) {
    throw new SwapCurrencyError(swapInfo, request)
  }

  if (/country-blocked/i.test(quoteErrorMessage)) {
    throw new SwapPermissionError(swapInfo, 'geoRestriction')
  }
  throw new Error(`SideShift.ai error ${quoteErrorMessage}`)
}

interface CreateSideshiftApiResponse {
  get: <R>(path: string) => Promise<R>
  post: <R>(path: string, body: {}) => Promise<R>
}

const createSideshiftApi = (
  baseUrl: string,
  fetchCors: EdgeFetchFunction,
  privateKey?: string
): CreateSideshiftApiResponse => {
  async function request<R>(
    method: 'GET' | 'POST',
    path: string,
    body?: JsonObject
  ): Promise<R> {
    const url = `${baseUrl}${path}`

    const headers: StringMap = {
      'Content-Type': 'application/json'
    }
    if (privateKey != null) {
      headers['x-sideshift-secret'] = privateKey
    }

    const reply = await (method === 'GET'
      ? fetchCors(url, { headers })
      : fetchCors(url, {
          method,
          headers,
          body: JSON.stringify(body)
        }))

    try {
      return await reply.json()
    } catch (e) {
      throw new Error(`SideShift.ai returned error code ${reply.status}`)
    }
  }

  return {
    get: async <R>(path: string): Promise<R> => await request<R>('GET', path),
    post: async <R>(path: string, body: {}): Promise<R> =>
      await request<R>('POST', path, body)
  }
}

const fetchSwapQuoteInner = async (
  request: EdgeSwapRequestPlugin,
  api: SideshiftApi,
  affiliateId: string
): Promise<SwapOrder> => {
  const [refundAddress, settleAddress] = await Promise.all([
    getAddress(request.fromWallet),
    getAddress(request.toWallet)
  ])

  const {
    fromCurrencyCode,
    toCurrencyCode,
    fromMainnetCode,
    toMainnetCode
  } = await getChainAndTokenCodes(
    request,
    swapInfo,
    chainCodeTickerMap,
    MAINNET_CODE_TRANSCRIPTION
  )

  const rate = asRate(
    await api.get<typeof asRate>(
      `/pair/${fromCurrencyCode}-${fromMainnetCode}/${toCurrencyCode}-${toMainnetCode}`
    )
  )

  if ('error' in rate) {
    throw new SwapCurrencyError(swapInfo, request)
  }

  const permissions = asPermissions(
    await api.get<typeof asPermissions>('/permissions')
  )

  if (!permissions.createShift) {
    throw new SwapPermissionError(swapInfo, 'geoRestriction')
  }

  const quoteAmount = await (request.quoteFor === 'from'
    ? request.fromWallet.nativeToDenomination(
        request.nativeAmount,
        request.fromCurrencyCode
      )
    : request.toWallet.nativeToDenomination(
        request.nativeAmount,
        request.toCurrencyCode
      ))

  const fixedQuoteRequest = asFixedQuoteRequest({
    depositCoin: fromCurrencyCode,
    depositNetwork: fromMainnetCode,
    settleCoin: toCurrencyCode,
    settleNetwork: toMainnetCode,
    depositAmount: request.quoteFor === 'from' ? quoteAmount : undefined,
    settleAmount: request.quoteFor === 'to' ? quoteAmount : undefined,
    affiliateId
  })

  const fixedQuote = asFixedQuote(
    await api.post<typeof asFixedQuote>('/quotes', fixedQuoteRequest)
  )

  if ('error' in fixedQuote) {
    await checkQuoteError(rate, request, fixedQuote.error.message)
    throw new Error(`SideShift.ai error ${fixedQuote.error.message}`)
  }

  const shiftRequest = asShiftRequest({
    quoteId: fixedQuote.id,
    affiliateId,
    settleAddress,
    refundAddress
  })

  const order = asOrder(
    await api.post<typeof asOrder>('/shifts/fixed', shiftRequest)
  )

  if ('error' in order) {
    await checkQuoteError(rate, request, order.error.message)
    throw new Error(`SideShift.ai error ${order.error.message}`)
  }

  const amountExpectedFromNative = await request.fromWallet.denominationToNative(
    order.depositAmount,
    request.fromCurrencyCode
  )

  const amountExpectedToNative = await request.toWallet.denominationToNative(
    order.settleAmount,
    request.toCurrencyCode
  )

  const isEstimate = false

  const memos: EdgeMemo[] =
    order.depositMemo == null
      ? []
      : [
          {
            type: memoType(request.fromWallet.currencyInfo.pluginId),
            value: order.depositMemo
          }
        ]

  const spendInfo: EdgeSpendInfo = {
    tokenId: request.fromTokenId,
    spendTargets: [
      {
        nativeAmount: amountExpectedFromNative,
        publicAddress: order.depositAddress
      }
    ],
    memos,
    networkFeeOption:
      request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
    assetAction: {
      assetActionType: 'swap'
    },
    savedAction: {
      actionType: 'swap',
      swapInfo,
      orderId: order.id,
      orderUri: ORDER_STATUS_URL + order.id,
      isEstimate,
      toAsset: {
        pluginId: request.toWallet.currencyInfo.pluginId,
        tokenId: request.toTokenId,
        nativeAmount: amountExpectedToNative
      },
      fromAsset: {
        pluginId: request.fromWallet.currencyInfo.pluginId,
        tokenId: request.fromTokenId,
        nativeAmount: amountExpectedFromNative
      },
      payoutAddress: settleAddress,
      payoutWalletId: request.toWallet.id,
      refundAddress
    }
  }

  return {
    request,
    spendInfo,
    swapInfo,
    fromNativeAmount: amountExpectedFromNative,
    expirationDate: ensureInFuture(new Date(order.expiresAt))
  }
}

// Provider data
let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60 // 1 hour

async function fetchSupportedAssets(
  api: CreateSideshiftApiResponse,
  log: EdgeLog
): Promise<void> {
  if (lastUpdated > Date.now() - EXPIRATION) return

  try {
    const json = await api.get('/coins')
    const assets = asSideshiftAssets(json)

    const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
    const out: ChainCodeTickerMap = new Map()
    for (const asset of assets) {
      const mainnetObj = asMaybe(asMainnetAsset)(asset)
      if (mainnetObj != null) {
        for (const network of mainnetObj.networks) {
          if (chaincodeArray.includes(network)) {
            const tokenCodes = out.get(network) ?? []
            tokenCodes.push({
              tokenCode: mainnetObj.coin,
              contractAddress: null
            })
            out.set(network, tokenCodes)
          }
        }
      }

      const tokenObj = asMaybe(asTokenAsset)(asset)
      if (tokenObj != null) {
        for (const network of tokenObj.networks) {
          if (chaincodeArray.includes(network)) {
            const tokenCodes = out.get(network) ?? []
            const networkObj = Object.keys(tokenObj.tokenDetails).find(
              networkName => networkName === network
            )
            if (networkObj == null) continue
            tokenCodes.push({
              tokenCode: tokenObj.coin,
              contractAddress: tokenObj.tokenDetails[networkObj].contractAddress
            })
            out.set(network, tokenCodes)
          }
        }
      }
    }

    chainCodeTickerMap = out
    lastUpdated = Date.now()
  } catch (e) {
    log.warn('SideShift: Error updating supported assets', e)
  }
}

const createFetchSwapQuote = (
  api: SideshiftApi,
  affiliateId: string,
  log: EdgeLog
) =>
  async function fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
    const request = convertRequest(req)

    // Fetch and persist chaincode/tokencode maps from provider
    await fetchSupportedAssets(api, log)

    checkWhitelistedMainnetCodes(MAINNET_CODE_TRANSCRIPTION, request, swapInfo)

    const newRequest = await getMaxSwappable(
      fetchSwapQuoteInner,
      request,
      api,
      affiliateId
    )
    const swapOrder = await fetchSwapQuoteInner(newRequest, api, affiliateId)
    return await makeSwapPluginQuote(swapOrder)
  }

export function makeSideshiftPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, initOptions } = opts
  const api = createSideshiftApi(
    SIDESHIFT_BASE_URL,
    io.fetchCors ?? io.fetch,
    initOptions.privateKey
  )
  const fetchSwapQuote = createFetchSwapQuote(
    api,
    initOptions.affiliateId,
    opts.log
  )

  return {
    swapInfo,
    fetchSwapQuote
  }
}

interface Rate {
  rate: string
  min: string
  max: string
}

interface SideshiftApi {
  get: <R>(path: string) => Promise<R>
  post: <R>(path: string, body: {}) => Promise<R>
}

const asError = asObject({ error: asObject({ message: asString }) })

const asPermissions = asObject({
  createShift: asBoolean
})

const asRate = asEither(
  asObject({
    rate: asString,
    min: asString,
    max: asString,
    depositCoin: asString,
    depositNetwork: asString,
    settleCoin: asString,
    settleNetwork: asString
  }),
  asError
)

const asFixedQuoteRequest = asObject({
  depositCoin: asString,
  depositNetwork: asString,
  settleCoin: asString,
  settleNetwork: asString,
  depositAmount: asOptional(asString),
  settleAmount: asOptional(asString),
  affiliateId: asString
})

const asFixedQuote = asEither(
  asObject({
    id: asString
  }),
  asError
)

const asShiftRequest = asObject({
  quoteId: asString,
  affiliateId: asString,
  settleAddress: asString,
  refundAddress: asString
})

const asOrder = asEither(
  asObject({
    id: asString,
    expiresAt: asString,
    depositAddress: asString,
    depositMemo: asOptional(asString),
    settleAmount: asString,
    depositAmount: asString
  }),
  asError
)

const asMainnetAsset = asObject({
  networks: asArray(asString),
  coin: asString,
  mainnet: asString
})
const asTokenAsset = asObject({
  networks: asArray(asString),
  coin: asString,
  tokenDetails: asObject(
    asObject({
      contractAddress: asString
    })
  )
})
const asSideshiftAssets = asArray(asUnknown)
