import { add, div, gt, lt, mul, round, sub } from 'biggystring'
import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeFetchFunction,
  EdgeFetchOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
  isLikeKind,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  fetchInfo,
  fetchWaterfall,
  getAddress,
  makeQueryParams,
  promiseWithTimeout,
  QueryParams
} from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'
import { getEvmApprovalData, getEvmTokenData } from './defiUtils'

const pluginId = 'thorchain'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: true,
  displayName: 'Thorchain',
  supportEmail: 'support@edge.app'
}

export const MIDGARD_SERVERS_DEFAULT = ['https://midgard.thorchain.info']
export const THORNODE_SERVERS_DEFAULT = ['https://thornode.ninerealms.com']
export const EXPIRATION_MS = 1000 * 60
export const DIVIDE_PRECISION = 16
export const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
export const EVM_SEND_GAS = '80000'
export const EVM_TOKEN_SEND_GAS = '80000'
export const MIN_USD_SWAP = '10'
export const THOR_LIMIT_UNITS = '100000000'
const AFFILIATE_FEE_BASIS_DEFAULT = '50'
const STREAMING_INTERVAL_DEFAULT = 10
const STREAMING_QUANTITY_DEFAULT = 10
const STREAMING_INTERVAL_NOSTREAM = 1
const STREAMING_QUANTITY_NOSTREAM = 1

// ----------------------------------------------------------------------------
// Volatility spread logic
//
// BTC/BCH have 10 min block times which can lead to more volatility
// so set them at the highest volatility of 1.5%
//
// LTC/DOGE have ~2min block time creating medium volatility so set to 1%
// Remaining chains are faster EVM chains so use the default 0.75% for most
// assets and 0.5% for like-kind assets
//
// These are all defaults and can be changed via the info server
// ----------------------------------------------------------------------------
export const VOLATILITY_SPREAD_DEFAULT = 0.0075
export const LIKE_KIND_VOLATILITY_SPREAD_DEFAULT = 0.005
export const VOLATILITY_SPREAD_STREAMING_DEFAULT = 0.001
export const LIKE_KIND_VOLATILITY_SPREAD_STREAMING_DEFAULT = 0
export const PER_ASSET_SPREAD_DEFAULT: AssetSpread[] = [
  {
    sourcePluginId: 'bitcoin',
    volatilitySpread: 0.015,
    sourceTokenId: undefined,
    sourceCurrencyCode: undefined,
    destPluginId: undefined,
    destTokenId: undefined,
    destCurrencyCode: undefined
  },
  {
    sourcePluginId: 'bitcoincash',
    volatilitySpread: 0.015,
    sourceTokenId: undefined,
    sourceCurrencyCode: undefined,
    destPluginId: undefined,
    destTokenId: undefined,
    destCurrencyCode: undefined
  },
  {
    sourcePluginId: 'dogecoin',
    volatilitySpread: 0.01,
    sourceTokenId: undefined,
    sourceCurrencyCode: undefined,
    destPluginId: undefined,
    destTokenId: undefined,
    destCurrencyCode: undefined
  },
  {
    sourcePluginId: 'litecoin',
    volatilitySpread: 0.01,
    sourceTokenId: undefined,
    sourceCurrencyCode: undefined,
    destPluginId: undefined,
    destTokenId: undefined,
    destCurrencyCode: undefined
  }
]

export const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    optimism: ['VELO']
  },
  to: {
    zcash: ['ZEC']
  }
}

export const EVM_CURRENCY_CODES: { [cc: string]: boolean } = {
  AVAX: true,
  BCH: false,
  BNB: false,
  BTC: false,
  DOGE: false,
  ETC: true,
  ETH: true,
  FTM: true,
  LTC: false,
  THOR: false
}

// Network names that don't match parent network currency code
export const MAINNET_CODE_TRANSCRIPTION: { [cc: string]: ChainTypes } = {
  avalanche: 'AVAX',
  binancechain: 'BNB',
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  dogecoin: 'DOGE',
  ethereum: 'ETH',
  litecoin: 'LTC',
  thorchain: 'THOR'
}

export const asInitOptions = asObject({
  appId: asOptional(asString, 'edge'),
  affiliateFeeBasis: asOptional(asString, AFFILIATE_FEE_BASIS_DEFAULT),
  ninerealmsClientId: asOptional(asString, ''),
  thorname: asOptional(asString, 'ej')
})

const asMinAmount = asObject({
  minInputAmount: asString
})

export const asInboundAddresses = asArray(
  asObject({
    address: asString,
    chain: asString,
    outbound_fee: asString,
    halted: asBoolean,
    pub_key: asString,
    router: asOptional(asString)
  })
)

export const asPool = asObject({
  asset: asString,
  status: asString,
  assetPrice: asString,
  assetPriceUSD: asString,
  assetDepth: asString,
  runeDepth: asString
})

export const asAssetSpread = asObject({
  sourcePluginId: asOptional(asString),
  sourceTokenId: asOptional(asString),
  sourceCurrencyCode: asOptional(asString),
  destPluginId: asOptional(asString),
  destTokenId: asOptional(asString),
  destCurrencyCode: asOptional(asString),
  volatilitySpread: asNumber
})

export const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      thorchain: asObject({
        perAssetSpread: asArray(asAssetSpread),
        perAssetSpreadStreaming: asOptional(asArray(asAssetSpread)),
        volatilitySpread: asNumber,
        volatilitySpreadStreaming: asOptional(asNumber),
        likeKindVolatilitySpread: asNumber,
        likeKindVolatilitySpreadStreaming: asOptional(asNumber),
        daVolatilitySpread: asNumber,
        midgardServers: asArray(asString),
        affiliateFeeBasis: asOptional(asString),
        nineRealmsServers: asOptional(asArray(asString)),
        streamingInterval: asOptional(asNumber),
        streamingQuantity: asOptional(asNumber),
        thornodeServers: asOptional(asArray(asString)),
        thorSwapServers: asOptional(asArray(asString))
      })
    })
  })
})

const asPools = asArray(asPool)

const asQuoteSwap = asObject({
  // expected_amount_out: asString, // "61409897"
  expected_amount_out_streaming: asString, // "62487221"
  expiry: asNumber, // 1692149478
  // fees: asObject({
  //   affiliate: asString, // "0"
  //   asset: asString, // "ETH.WBTC-0X2260FAC5E5542A773AA44FBCFEDF7C193BC2C599",
  //   outbound: asString // "22117"
  // }),
  inbound_address: asString, // "0x88e8def37dc9d2acd67f1c1574ad09ca49827374",
  // max_streaming_quantity: asNumber, // 18,
  memo: asString, // "=:ETH.WBTC-0X2260FAC5E5542A773AA44FBCFEDF7C193BC2C599:0x04c5998ded94f89263370444ce64a99b7dbc9f46:0/10/0",
  // outbound_delay_blocks: asNumber, // 114,
  // outbound_delay_seconds: asNumber, // 684,
  // recommended_min_amount_in: asString, // "1440032",
  router: asOptional(asString), // "0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146",
  // slippage_bps: asNumber, // 92,
  // streaming_slippage_bps: asNumber, // 5,
  streaming_swap_blocks: asNumber, // 170,
  total_swap_seconds: asOptional(asNumber) // 1020,
})

type QuoteSwap = ReturnType<typeof asQuoteSwap>
type AssetSpread = ReturnType<typeof asAssetSpread>
type Pool = ReturnType<typeof asPool>
type ExchangeInfo = ReturnType<typeof asExchangeInfo>
type MinAmount = ReturnType<typeof asMinAmount>
interface CalcSwapParams {
  log: Function
  fetch: EdgeFetchFunction
  thornodes: string[]
  thornodesFetchOptions: any
  fromWallet: EdgeCurrencyWallet
  fromCurrencyCode: string
  toWallet: EdgeCurrencyWallet
  toCurrencyCode: string
  toAddress: string
  isEstimate: boolean
  nativeAmount: string
  minAmount: MinAmount | undefined
  sourcePool: Pool
  destPool: Pool
  thorname: string
  volatilitySpreadFinal: string
  volatilitySpreadStreamingFinal: string
  affiliateFeeBasis: string
  streamingInterval: number
  streamingQuantity: number
  dontCheckLimits?: boolean
}

interface CalcSwapResponse {
  canBePartial: boolean
  fromNativeAmount: string
  fromExchangeAmount: string
  maxFulfillmentSeconds?: number
  toNativeAmount: string
  toExchangeAmount: string
  thorAddress: string
  router?: string
  memo: string
}

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0

export function makeThorchainPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)
  const { appId, thorname, ninerealmsClientId } = initOptions
  let { affiliateFeeBasis = AFFILIATE_FEE_BASIS_DEFAULT } = initOptions

  const headers = {
    'Content-Type': 'application/json',
    'x-client-id': ninerealmsClientId
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    isEstimate: boolean
  ): Promise<SwapOrder> => {
    const {
      fromCurrencyCode,
      fromTokenId,
      toCurrencyCode,
      toTokenId,
      nativeAmount,
      fromWallet,
      toWallet,
      quoteFor
    } = request
    // Do not support transfer between same assets
    if (
      fromWallet.currencyInfo.pluginId === toWallet.currencyInfo.pluginId &&
      request.fromCurrencyCode === request.toCurrencyCode
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    let midgardServers: string[] = MIDGARD_SERVERS_DEFAULT
    let thornodeServers: string[] = THORNODE_SERVERS_DEFAULT
    let likeKindVolatilitySpread: number = LIKE_KIND_VOLATILITY_SPREAD_DEFAULT
    let likeKindVolatilitySpreadStreaming: number = LIKE_KIND_VOLATILITY_SPREAD_STREAMING_DEFAULT
    let volatilitySpread: number = VOLATILITY_SPREAD_DEFAULT
    let volatilitySpreadStreaming: number = VOLATILITY_SPREAD_STREAMING_DEFAULT
    let perAssetSpread: AssetSpread[] = PER_ASSET_SPREAD_DEFAULT
    let perAssetSpreadStreaming: AssetSpread[] = PER_ASSET_SPREAD_DEFAULT
    let streamingInterval: number = STREAMING_INTERVAL_DEFAULT
    let streamingQuantity: number = STREAMING_QUANTITY_DEFAULT

    checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

    // Grab addresses:
    const toAddress = await getAddress(toWallet)

    const fromMainnetCode =
      MAINNET_CODE_TRANSCRIPTION[fromWallet.currencyInfo.pluginId]
    const toMainnetCode =
      MAINNET_CODE_TRANSCRIPTION[toWallet.currencyInfo.pluginId]

    if (fromMainnetCode == null || toMainnetCode == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const now = Date.now()
    if (
      now - exchangeInfoLastUpdate > EXCHANGE_INFO_UPDATE_FREQ_MS ||
      exchangeInfo == null
    ) {
      try {
        const exchangeInfoResponse = await promiseWithTimeout(
          fetchInfo(fetchCors, `v1/exchangeInfo/${appId}`)
        )

        if (exchangeInfoResponse.ok === true) {
          exchangeInfo = asExchangeInfo(await exchangeInfoResponse.json())
          exchangeInfoLastUpdate = now
        } else {
          // Error is ok. We just use defaults
          log('Error getting info server exchangeInfo. Using defaults...')
        }
      } catch (e: any) {
        log(
          'Error getting info server exchangeInfo. Using defaults...',
          e.message
        )
      }
    }

    if (exchangeInfo != null) {
      const { thorchain } = exchangeInfo.swap.plugins
      likeKindVolatilitySpread =
        exchangeInfo.swap.plugins.thorchain.likeKindVolatilitySpread
      volatilitySpread = thorchain.volatilitySpread
      likeKindVolatilitySpreadStreaming =
        exchangeInfo.swap.plugins.thorchain.likeKindVolatilitySpreadStreaming ??
        likeKindVolatilitySpreadStreaming
      volatilitySpreadStreaming =
        thorchain.volatilitySpreadStreaming ?? volatilitySpreadStreaming
      midgardServers = thorchain.midgardServers
      thornodeServers = thorchain.thornodeServers ?? thornodeServers
      perAssetSpread = thorchain.perAssetSpread
      perAssetSpreadStreaming =
        thorchain.perAssetSpreadStreaming ?? perAssetSpreadStreaming
      affiliateFeeBasis = thorchain.affiliateFeeBasis ?? affiliateFeeBasis
      streamingInterval = thorchain.streamingInterval ?? streamingInterval
      streamingQuantity = thorchain.streamingQuantity ?? streamingQuantity
    }

    const volatilitySpreadFinal = isEstimate
      ? '0'
      : getVolatilitySpread({
          fromPluginId: fromWallet.currencyInfo.pluginId,
          fromTokenId,
          fromCurrencyCode,
          toPluginId: toWallet.currencyInfo.pluginId,
          toTokenId,
          toCurrencyCode,
          likeKindVolatilitySpread,
          volatilitySpread,
          perAssetSpread
        })

    const volatilitySpreadStreamingFinal = isEstimate
      ? '0'
      : getVolatilitySpread({
          fromPluginId: fromWallet.currencyInfo.pluginId,
          fromTokenId,
          fromCurrencyCode,
          toPluginId: toWallet.currencyInfo.pluginId,
          toTokenId,
          toCurrencyCode,
          likeKindVolatilitySpread: likeKindVolatilitySpreadStreaming,
          volatilitySpread: volatilitySpreadStreaming,
          perAssetSpread: perAssetSpreadStreaming
        })

    log.warn(`volatilitySpreadFinal: ${volatilitySpreadFinal.toString()}`)
    log.warn(
      `volatilitySpreadStreamingFinal: ${volatilitySpreadStreamingFinal.toString()}`
    )

    // Get current pool
    const poolResponse = await fetchWaterfall(
      fetchCors,
      midgardServers,
      'v2/pools',
      { headers }
    )

    if (!poolResponse.ok) {
      const responseText = await poolResponse.text()
      throw new Error(`Thorchain could not fetch pools: ${responseText}`)
    }

    // Nine realms servers removed minAmount support so disable for now but keep all code
    // logic so we can easily enable in the future with new API
    const minAmount = undefined

    const poolJson = await poolResponse.json()
    const pools = asPools(poolJson)

    const sourcePool = pools.find(pool => {
      const [asset] = pool.asset.split('-')
      return asset === `${fromMainnetCode}.${fromCurrencyCode}`
    })
    if (sourcePool == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    const [
      sourceAsset,
      sourceTokenContractAddressAllCaps
    ] = sourcePool.asset.split('-')
    const sourceTokenContractAddress =
      sourceTokenContractAddressAllCaps != null
        ? sourceTokenContractAddressAllCaps.toLowerCase()
        : undefined
    log(`sourceAsset: ${sourceAsset}`)

    const destPool = pools.find(pool => {
      const [asset] = pool.asset.split('-')
      return asset === `${toMainnetCode}.${toCurrencyCode}`
    })
    if (destPool == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    let calcResponse: CalcSwapResponse
    if (quoteFor === 'from') {
      calcResponse = await calcSwapFrom({
        log,
        fetch: fetchCors,
        thornodes: thornodeServers,
        thornodesFetchOptions: { headers },
        fromWallet,
        fromCurrencyCode,
        toWallet,
        toCurrencyCode,
        toAddress,
        isEstimate,
        nativeAmount,
        minAmount,
        sourcePool,
        destPool,
        thorname,
        volatilitySpreadFinal,
        volatilitySpreadStreamingFinal,
        affiliateFeeBasis,
        streamingInterval,
        streamingQuantity
      })
    } else {
      calcResponse = await calcSwapTo({
        log,
        fetch: fetchCors,
        thornodes: thornodeServers,
        thornodesFetchOptions: { headers },
        fromWallet,
        fromCurrencyCode,
        toWallet,
        toCurrencyCode,
        toAddress,
        isEstimate,
        nativeAmount,
        minAmount,
        sourcePool,
        destPool,
        thorname,
        volatilitySpreadFinal,
        volatilitySpreadStreamingFinal,
        affiliateFeeBasis,
        streamingInterval,
        streamingQuantity
      })
    }
    const {
      canBePartial,
      fromNativeAmount,
      maxFulfillmentSeconds,
      toNativeAmount,
      router,
      thorAddress
    } = calcResponse
    let { memo } = calcResponse

    let ethNativeAmount = fromNativeAmount
    let publicAddress = thorAddress
    let approvalData
    if (EVM_CURRENCY_CODES[fromMainnetCode]) {
      if (fromMainnetCode !== fromCurrencyCode) {
        if (router == null)
          throw new Error(`Missing router address for ${fromMainnetCode}`)
        if (sourceTokenContractAddress == null)
          throw new Error(
            `Missing sourceTokenContractAddress for ${fromMainnetCode}`
          )
        // Need to use ethers.js to craft a proper tx that calls Thorchain contract, then extract the data payload
        memo = await getEvmTokenData({
          assetAddress: sourceTokenContractAddress,
          amountToSwapWei: Number(fromNativeAmount),
          contractAddress: router,
          vaultAddress: thorAddress,
          memo
        })

        // Token transactions send no ETH (or other EVM mainnet coin)
        ethNativeAmount = '0'
        publicAddress = router

        // Check if token approval is required and return necessary data field
        approvalData = await getEvmApprovalData({
          contractAddress: router,
          assetAddress: sourceTokenContractAddress,
          nativeAmount: fromNativeAmount
        })
      } else {
        memo = '0x' + Buffer.from(memo).toString('hex')
      }
    } else {
      // Cannot yet do tokens on non-EVM chains
      if (fromMainnetCode !== fromCurrencyCode) {
        throw new SwapCurrencyError(swapInfo, request)
      }
    }

    let preTx: EdgeTransaction | undefined
    if (approvalData != null) {
      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            memo: approvalData,
            nativeAmount: '0',
            publicAddress: sourceTokenContractAddress
          }
        ],
        metadata: {
          name: 'Thorchain',
          category: 'expense:Token Approval'
        }
      }
      preTx = await request.fromWallet.makeSpend(spendInfo)
    }

    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          memo,
          nativeAmount: ethNativeAmount,
          publicAddress
        }
      ],

      swapData: {
        isEstimate: false,
        payoutAddress: toAddress,
        payoutCurrencyCode: toCurrencyCode,
        payoutNativeAmount: toNativeAmount,
        payoutWalletId: toWallet.id,
        plugin: { ...swapInfo }
      },
      otherParams: {
        outputSort: 'targets'
      }
    }

    if (EVM_CURRENCY_CODES[fromMainnetCode]) {
      if (fromMainnetCode === fromCurrencyCode) {
        // For mainnet coins of EVM chains, use gasLimit override since makeSpend doesn't
        // know how to estimate an ETH spend with extra data
        const gasLimit = getGasLimit(fromMainnetCode, fromCurrencyCode)
        if (gasLimit != null) {
          spendInfo.customNetworkFee = {
            ...spendInfo.customNetworkFee,
            gasLimit
          }
        }
      }
    }

    return {
      canBePartial,
      maxFulfillmentSeconds,
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: new Date(Date.now() + EXPIRATION_MS),
      preTx
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      const newRequest = await getMaxSwappable(
        fetchSwapQuoteInner,
        request,
        true
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest, true)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

const calcSwapFrom = async ({
  log,
  fetch,
  thornodes,
  thornodesFetchOptions,
  fromWallet,
  fromCurrencyCode,
  toWallet,
  toCurrencyCode,
  toAddress,
  isEstimate,
  nativeAmount,
  minAmount,
  sourcePool,
  destPool,
  thorname,
  volatilitySpreadFinal,
  volatilitySpreadStreamingFinal,
  affiliateFeeBasis,
  streamingInterval,
  streamingQuantity,
  dontCheckLimits = false
}: CalcSwapParams): Promise<CalcSwapResponse> => {
  const fromNativeAmount = nativeAmount

  // Get exchange rate from source to destination asset
  const fromExchangeAmount = await fromWallet.nativeToDenomination(
    nativeAmount,
    fromCurrencyCode
  )

  log(`fromExchangeAmount: ${fromExchangeAmount}`)

  // Check minimums if we can
  if (!dontCheckLimits) {
    const srcInUsd = mul(sourcePool.assetPriceUSD, fromExchangeAmount)
    let fromMinNativeAmount
    if (lt(srcInUsd, MIN_USD_SWAP)) {
      const minExchangeAmount = div(
        MIN_USD_SWAP,
        sourcePool.assetPriceUSD,
        DIVIDE_PRECISION
      )
      fromMinNativeAmount = await fromWallet.denominationToNative(
        minExchangeAmount,
        fromCurrencyCode
      )
    }

    if (minAmount != null && lt(fromExchangeAmount, minAmount.minInputAmount)) {
      const tempNativeMin = await fromWallet.denominationToNative(
        minAmount.minInputAmount,
        fromCurrencyCode
      )
      if (gt(tempNativeMin, fromMinNativeAmount ?? '0')) {
        fromMinNativeAmount = tempNativeMin
      }
    }
    if (fromMinNativeAmount != null) {
      throw new SwapBelowLimitError(swapInfo, fromMinNativeAmount, 'from')
    }
  }

  const fromThorAmount = mul(fromExchangeAmount, THOR_LIMIT_UNITS)

  const noStreamParams = {
    amount: fromThorAmount,
    from_asset: sourcePool.asset,
    to_asset: destPool.asset,
    destination: toAddress,
    affiliate: thorname,
    affiliate_bps: affiliateFeeBasis,
    streaming_interval: STREAMING_INTERVAL_NOSTREAM,
    streaming_quantity: STREAMING_QUANTITY_NOSTREAM
  }

  const streamParams = {
    ...noStreamParams,
    streaming_interval: streamingInterval,
    streaming_quantity: streamingQuantity
  }
  const bestQuote = await getBestQuote(
    [noStreamParams, streamParams],
    fetch,
    thornodes,
    thornodesFetchOptions
  )

  const {
    expected_amount_out_streaming: toThorAmount,
    inbound_address: thorAddress,
    memo: preMemo,
    router,
    streaming_swap_blocks: streamingSwapBlocks,
    total_swap_seconds: maxFulfillmentSeconds
  } = bestQuote

  const canBePartial = streamingSwapBlocks > 1
  let toThorAmountWithSpread: string
  if (canBePartial) {
    log(`volatilitySpreadStreamingFinal: ${volatilitySpreadStreamingFinal}`)
    toThorAmountWithSpread = round(
      mul(sub('1', volatilitySpreadStreamingFinal), toThorAmount),
      0
    )
  } else {
    log(`volatilitySpreadFinal: ${volatilitySpreadFinal}`)
    toThorAmountWithSpread = round(
      mul(sub('1', volatilitySpreadFinal), toThorAmount),
      0
    )
  }

  log(`toThorAmountWithSpread = limit: ${toThorAmountWithSpread}`)

  const toExchangeAmount = div(
    toThorAmountWithSpread,
    THOR_LIMIT_UNITS,
    DIVIDE_PRECISION
  )
  log(`toExchangeAmount: ${toExchangeAmount}`)

  const toNativeAmountFloat = await toWallet.denominationToNative(
    toExchangeAmount,
    toCurrencyCode
  )
  const toNativeAmount = round(toNativeAmountFloat, 0)
  log(`toNativeAmount: ${toNativeAmount}`)

  const memo = isEstimate
    ? preMemo
    : preMemo.replace(':0/', `:${toThorAmountWithSpread}/`)

  return {
    canBePartial,
    fromNativeAmount,
    fromExchangeAmount,
    maxFulfillmentSeconds,
    toNativeAmount,
    toExchangeAmount,
    memo,
    router,
    thorAddress
  }
}

const calcSwapTo = async ({
  log,
  fetch,
  thornodes,
  thornodesFetchOptions,
  fromWallet,
  fromCurrencyCode,
  toWallet,
  toCurrencyCode,
  toAddress,
  nativeAmount,
  isEstimate,
  sourcePool,
  destPool,
  thorname,
  volatilitySpreadFinal,
  volatilitySpreadStreamingFinal,
  affiliateFeeBasis,
  streamingInterval,
  streamingQuantity,
  dontCheckLimits = false
}: CalcSwapParams): Promise<CalcSwapResponse> => {
  const toNativeAmount = nativeAmount

  // Get exchange rate from source to destination asset
  const toExchangeAmount = await toWallet.nativeToDenomination(
    nativeAmount,
    toCurrencyCode
  )

  const requestedToThorAmount = mul(toExchangeAmount, THOR_LIMIT_UNITS)

  log(`toExchangeAmount: ${toExchangeAmount}`)

  // Convert to a 'from' amount using pool rates
  const sourcePrice = sourcePool.assetPrice
  const destPrice = destPool.assetPrice

  const requestedFromExchangeAmount = mul(
    toExchangeAmount,
    div(destPrice, sourcePrice, DIVIDE_PRECISION)
  )

  const requestedFromThorAmount = round(
    mul(requestedFromExchangeAmount, THOR_LIMIT_UNITS),
    0
  )

  const noStreamParams = {
    amount: requestedFromThorAmount,
    from_asset: sourcePool.asset,
    to_asset: destPool.asset,
    destination: toAddress,
    affiliate: thorname,
    affiliate_bps: affiliateFeeBasis,
    streaming_interval: STREAMING_INTERVAL_NOSTREAM,
    streaming_quantity: STREAMING_QUANTITY_NOSTREAM
  }
  const streamParams = {
    ...noStreamParams,
    streaming_interval: streamingInterval,
    streaming_quantity: streamingQuantity
  }

  const bestQuote = await getBestQuote(
    [noStreamParams, streamParams],
    fetch,
    thornodes,
    thornodesFetchOptions
  )

  const {
    expected_amount_out_streaming: toThorAmount,
    inbound_address: thorAddress,
    memo: preMemo,
    router,
    streaming_swap_blocks: streamingSwapBlocks,
    total_swap_seconds: maxFulfillmentSeconds
  } = bestQuote

  const canBePartial = streamingSwapBlocks > 1

  // Get the percent drop from the 'to' amount the user wanted compared to the
  // 'to' amount returned by the API. Add that percent to the 'from' amount to
  // estimate how much more the user has to send.
  const feeRatio = div(requestedToThorAmount, toThorAmount, DIVIDE_PRECISION)
  log(`feeRatio: ${feeRatio}`)

  const fromThorAmount = mul(requestedFromThorAmount, feeRatio)

  let fromThorAmountWithSpread: string
  if (canBePartial) {
    log(`volatilitySpreadStreamingFinal: ${volatilitySpreadStreamingFinal}`)
    fromThorAmountWithSpread = round(
      mul(add('1', volatilitySpreadStreamingFinal), fromThorAmount),
      0
    )
  } else {
    log(`volatilitySpreadFinal: ${volatilitySpreadFinal}`)
    fromThorAmountWithSpread = round(
      mul(add('1', volatilitySpreadFinal), fromThorAmount),
      0
    )
  }

  log(`fromThorAmountWithSpread = limit: ${fromThorAmountWithSpread}`)

  const fromExchangeAmount = div(
    fromThorAmountWithSpread,
    THOR_LIMIT_UNITS,
    DIVIDE_PRECISION
  )
  log(`fromExchangeAmount: ${fromExchangeAmount}`)

  const fromNativeAmountFloat = await fromWallet.denominationToNative(
    fromExchangeAmount,
    fromCurrencyCode
  )
  const fromNativeAmount = round(fromNativeAmountFloat, 0)
  log(`fromNativeAmount: ${fromNativeAmount}`)

  const memo = isEstimate
    ? preMemo
    : preMemo.replace(':0/', `:${requestedToThorAmount}/`)

  return {
    canBePartial,
    fromNativeAmount,
    fromExchangeAmount,
    toNativeAmount,
    toExchangeAmount,
    maxFulfillmentSeconds,
    memo,
    router,
    thorAddress
  }
}

type ChainTypes =
  | 'BTC'
  | 'ETH'
  | 'BCH'
  | 'DOGE'
  | 'LTC'
  | 'AVAX'
  | 'BNB'
  | 'THOR'

const getBestQuote = async (
  params: QueryParams[],
  fetch: EdgeFetchFunction,
  thornodes: string[],
  thornodesFetchOptions: EdgeFetchOptions
): Promise<QuoteSwap> => {
  const quotes = await Promise.all(
    params.map(
      async p => await getQuote(p, fetch, thornodes, thornodesFetchOptions)
    )
  )

  let bestQuote: QuoteSwap | undefined
  for (const quote of quotes) {
    if (quote == null) continue
    if (bestQuote == null) {
      bestQuote = quote
      continue
    }
    if (
      gt(
        quote.expected_amount_out_streaming,
        bestQuote.expected_amount_out_streaming
      )
    ) {
      bestQuote = quote
    }
  }

  if (bestQuote == null) {
    throw new Error('Could not get quote')
  }
  return bestQuote
}

/**
 * getQuote must not throw!
 */
const getQuote = async (
  queryParams: QueryParams,
  fetch: EdgeFetchFunction,
  thornodes: string[],
  thornodesFetchOptions: EdgeFetchOptions
): Promise<QuoteSwap | undefined> => {
  const params = makeQueryParams(queryParams)

  try {
    const response = await fetchWaterfall(
      fetch,
      thornodes,
      `thorchain/quote/swap?${params}`,
      thornodesFetchOptions
    )
    let json
    try {
      json = await response.json()
    } catch (e) {
      const text = await response.text()
      console.error(text)
      return
    }
    console.log('cleaning')
    const quote = asQuoteSwap(json)
    return quote
  } catch (e) {
    console.error(`getQuote throw ${String(e)}`)
  }
}

export const getGasLimit = (
  chain: ChainTypes,
  asset: string
): string | undefined => {
  if (EVM_CURRENCY_CODES[chain]) {
    if (chain === asset) {
      return EVM_SEND_GAS
    } else {
      return EVM_TOKEN_SEND_GAS
    }
  }
}

export const getVolatilitySpread = ({
  fromPluginId,
  fromTokenId,
  fromCurrencyCode,
  toPluginId,
  toTokenId,
  toCurrencyCode,
  likeKindVolatilitySpread,
  volatilitySpread,
  perAssetSpread
}: {
  fromPluginId: string
  fromTokenId?: string
  fromCurrencyCode: string
  toPluginId: string
  toTokenId?: string
  toCurrencyCode: string
  likeKindVolatilitySpread: number
  volatilitySpread: number
  perAssetSpread: AssetSpread[]
}): string => {
  let volatilitySpreadFinal: number | undefined

  for (const spread of perAssetSpread) {
    const {
      sourcePluginId,
      sourceTokenId,
      sourceCurrencyCode,
      destPluginId,
      destTokenId,
      destCurrencyCode,
      volatilitySpread
    } = spread
    if (sourcePluginId != null && sourcePluginId !== fromPluginId) continue
    if (sourceTokenId != null && sourceTokenId !== fromTokenId) continue
    if (sourceCurrencyCode != null && sourceCurrencyCode !== fromCurrencyCode)
      continue
    if (destPluginId != null && destPluginId !== toPluginId) continue
    if (destTokenId != null && destTokenId !== toTokenId) continue
    if (destCurrencyCode != null && destCurrencyCode !== toCurrencyCode)
      continue
    volatilitySpreadFinal = volatilitySpread
    break
  }

  if (volatilitySpreadFinal == null) {
    const likeKind = isLikeKind(fromCurrencyCode, toCurrencyCode)

    volatilitySpreadFinal = likeKind
      ? likeKindVolatilitySpread
      : volatilitySpread
  }

  return volatilitySpreadFinal.toString()
}
