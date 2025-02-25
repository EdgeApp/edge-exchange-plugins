import { add, gt, mul, round, sub } from 'biggystring'
import {
  asArray,
  asBoolean,
  asMaybe,
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
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  EdgeTxActionSwap,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { div18 } from '../../../util/biggystringplus'
import {
  checkInvalidCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
  isLikeKind,
  makeSwapPluginQuote,
  SwapOrder
} from '../../../util/swapHelpers'
import {
  convertRequest,
  fetchInfo,
  fetchWaterfall,
  getAddress,
  makeQueryParams,
  promiseWithTimeout,
  QueryParams
} from '../../../util/utils'
import { EdgeSwapRequestPlugin, MakeTxParams } from '../../types'
import { getDepositWithExpiryData, getEvmApprovalData } from '../defiUtils'

export const EXPIRATION_MS = 1000 * 60
export const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
export const EVM_SEND_GAS = '80000'
export const EVM_TOKEN_SEND_GAS = '80000'
export const THOR_LIMIT_UNITS = '100000000'
export const AFFILIATE_FEE_BASIS_DEFAULT = '50'
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
    sourcePluginId: 'dash',
    volatilitySpread: 0.01,
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
  ARB: true,
  AVAX: true,
  BASE: true,
  BCH: false,
  BNB: false,
  BSC: true,
  BTC: false,
  DASH: false,
  DOGE: false,
  ETC: true,
  ETH: true,
  FTM: true,
  LTC: false,
  THOR: false
}

export const asInitOptions = asObject({
  appId: asOptional(asString, 'edge'),
  affiliateFeeBasis: asOptional(asString, AFFILIATE_FEE_BASIS_DEFAULT),
  ninerealmsClientId: asOptional(asString, ''),
  thorname: asOptional(asString, 'ej')
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
  // status: asString,
  assetPrice: asString,
  assetPriceUSD: asString
  // assetDepth: asString,
  // runeDepth: asString
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

const asExchangeInfo = asObject({
  perAssetSpread: asArray(asAssetSpread),
  perAssetSpreadStreaming: asOptional(asArray(asAssetSpread)),
  volatilitySpread: asNumber,
  volatilitySpreadStreaming: asOptional(asNumber),
  likeKindVolatilitySpread: asNumber,
  likeKindVolatilitySpreadStreaming: asOptional(asNumber),
  midgardServers: asArray(asString),
  affiliateFeeBasis: asOptional(asString),
  streamingInterval: asOptional(asNumber),
  streamingQuantity: asOptional(asNumber),
  thornodeServersWithPath: asOptional(asArray(asString))
})

const asExchangeInfoMap = asObject({
  swap: asObject({
    plugins: asObject(asMaybe(asExchangeInfo))
  })
})

const asPools = asArray(asPool)

const asQuoteSwap = asObject({
  expected_amount_out: asOptional(asString), // "61409897"
  /** @deprecated */
  expected_amount_out_streaming: asOptional(asString),
  expiry: asNumber, // 1692149478
  // fees: asObject({
  //   affiliate: asString, // "0"
  //   asset: asString, // "ETH.WBTC-0X2260FAC5E5542A773AA44FBCFEDF7C193BC2C599",
  //   outbound: asString // "22117"
  // }),
  inbound_address: asOptional(asString), // "0x88e8def37dc9d2acd67f1c1574ad09ca49827374",
  // max_streaming_quantity: asNumber, // 18,
  memo: asString, // "=:ETH.WBTC-0X2260FAC5E5542A773AA44FBCFEDF7C193BC2C599:0x04c5998ded94f89263370444ce64a99b7dbc9f46:0/10/0",
  // outbound_delay_blocks: asNumber, // 114,
  // outbound_delay_seconds: asNumber, // 684,
  recommended_min_amount_in: asString, // "1440032",
  router: asOptional(asString), // "0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146",
  // slippage_bps: asNumber, // 92,
  // streaming_slippage_bps: asNumber, // 5,
  streaming_swap_blocks: asNumber, // 170,
  total_swap_seconds: asOptional(asNumber) // 1020,
})

type QuoteSwap = ReturnType<typeof asQuoteSwap>
interface QuoteError {
  error: 'SwapMinError'
  minThorAmount: string
}

type QuoteSwapFull = QuoteSwap | QuoteError
type AssetSpread = ReturnType<typeof asAssetSpread>
type Pool = ReturnType<typeof asPool>
export type ExchangeInfo = ReturnType<typeof asExchangeInfo>
interface CalcSwapParams {
  swapInfo: EdgeSwapInfo
  log: Function
  fetch: EdgeFetchFunction
  thornodes: string[]
  thornodesFetchOptions: Record<string, string>
  fromWallet: EdgeCurrencyWallet
  fromCurrencyCode: string
  toWallet: EdgeCurrencyWallet
  toCurrencyCode: string
  toAddress: string
  isEstimate: boolean
  nativeAmount: string
  quoteFor: EdgeSwapRequestPlugin['quoteFor']
  sourcePool: Pool
  destPool: Pool
  thorname: string
  volatilitySpreadFinal: string
  volatilitySpreadStreamingFinal: string
  affiliateFeeBasis: string
  streamingInterval: number
  streamingQuantity: number
}

interface CalcSwapResponse {
  // canBePartial: boolean
  fromNativeAmount: string
  fromExchangeAmount: string
  maxFulfillmentSeconds?: number
  toNativeAmount: string
  toExchangeAmount: string
  thorAddress?: string
  router?: string
  memo: string
}

interface ThorchainOpts {
  MAINNET_CODE_TRANSCRIPTION: { [cc: string]: string }
  MIDGARD_SERVERS_DEFAULT: string[]
  THORNODE_SERVERS_DEFAULT: string[]
  infoServer: {
    exchangeInfo: ExchangeInfo | undefined
    exchangeInfoLastUpdate: number
  }
  orderUri: string
  swapInfo: EdgeSwapInfo
  thornodesFetchOptions?: Record<string, string>
}

export function makeThorchainBasedPlugin(
  opts: EdgeCorePluginOptions,
  thorchainOpts: ThorchainOpts
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)
  const { appId, thorname } = initOptions
  let { affiliateFeeBasis = AFFILIATE_FEE_BASIS_DEFAULT } = initOptions

  const {
    MAINNET_CODE_TRANSCRIPTION,
    MIDGARD_SERVERS_DEFAULT,
    THORNODE_SERVERS_DEFAULT,
    infoServer,
    orderUri,
    swapInfo,
    thornodesFetchOptions = {}
  } = thorchainOpts

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
    let thornodeServersWithPath: string[] = THORNODE_SERVERS_DEFAULT
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
      now - infoServer.exchangeInfoLastUpdate > EXCHANGE_INFO_UPDATE_FREQ_MS ||
      infoServer.exchangeInfo == null
    ) {
      try {
        const exchangeInfoResponse = await promiseWithTimeout(
          fetchInfo(fetchCors, `v1/exchangeInfo/${appId}`)
        )

        if (exchangeInfoResponse.ok === true) {
          const exchangeInfoMap = asExchangeInfoMap(
            await exchangeInfoResponse.json()
          )
          infoServer.exchangeInfo = asExchangeInfo(
            exchangeInfoMap.swap.plugins[swapInfo.pluginId]
          )
          infoServer.exchangeInfoLastUpdate = now
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

    if (infoServer.exchangeInfo != null) {
      likeKindVolatilitySpread =
        infoServer.exchangeInfo.likeKindVolatilitySpread
      volatilitySpread = infoServer.exchangeInfo.volatilitySpread
      likeKindVolatilitySpreadStreaming =
        infoServer.exchangeInfo.likeKindVolatilitySpreadStreaming ??
        likeKindVolatilitySpreadStreaming
      volatilitySpreadStreaming =
        infoServer.exchangeInfo.volatilitySpreadStreaming ??
        volatilitySpreadStreaming
      midgardServers = infoServer.exchangeInfo.midgardServers
      thornodeServersWithPath =
        infoServer.exchangeInfo.thornodeServersWithPath ??
        thornodeServersWithPath
      perAssetSpread = infoServer.exchangeInfo.perAssetSpread
      perAssetSpreadStreaming =
        infoServer.exchangeInfo.perAssetSpreadStreaming ??
        perAssetSpreadStreaming
      affiliateFeeBasis =
        infoServer.exchangeInfo.affiliateFeeBasis ?? affiliateFeeBasis
      streamingInterval =
        infoServer.exchangeInfo.streamingInterval ?? streamingInterval
      streamingQuantity =
        infoServer.exchangeInfo.streamingQuantity ?? streamingQuantity
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
      thornodesFetchOptions
    )

    if (!poolResponse.ok) {
      const responseText = await poolResponse.text()
      throw new Error(`Thorchain could not fetch pools: ${responseText}`)
    }

    const poolJson = await poolResponse.json()
    const pools = asPools(poolJson)

    const sourcePool = getPool(
      request,
      swapInfo,
      fromMainnetCode,
      fromCurrencyCode,
      pools
    )
    const [
      fromAsset,
      sourceTokenContractAddressAllCaps
    ] = sourcePool.asset.split('-')
    const sourceTokenContractAddress =
      sourceTokenContractAddressAllCaps != null
        ? sourceTokenContractAddressAllCaps.toLowerCase()
        : undefined
    log(`fromAsset: ${fromAsset}`)

    const destPool = getPool(
      request,
      swapInfo,
      toMainnetCode,
      toCurrencyCode,
      pools
    )

    let calcResponse: CalcSwapResponse
    if (quoteFor === 'from' || quoteFor === 'max') {
      calcResponse = await calcSwapFrom({
        swapInfo,
        log,
        fetch: fetchCors,
        thornodes: thornodeServersWithPath,
        thornodesFetchOptions,
        fromWallet,
        fromCurrencyCode,
        toWallet,
        toCurrencyCode,
        toAddress,
        isEstimate,
        nativeAmount,
        quoteFor,
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
        swapInfo,
        log,
        fetch: fetchCors,
        thornodes: thornodeServersWithPath,
        thornodesFetchOptions,
        fromWallet,
        fromCurrencyCode,
        toWallet,
        toCurrencyCode,
        toAddress,
        isEstimate,
        nativeAmount,
        quoteFor,
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
      // canBePartial,
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
    let memoType: EdgeMemo['type']

    const savedAction: EdgeTxActionSwap = {
      actionType: 'swap',
      swapInfo,
      orderUri,
      isEstimate,
      toAsset: {
        pluginId: toWallet.currencyInfo.pluginId,
        tokenId: toTokenId,
        nativeAmount: toNativeAmount
      },
      fromAsset: {
        pluginId: fromWallet.currencyInfo.pluginId,
        tokenId: fromTokenId,
        nativeAmount: fromNativeAmount
      },
      payoutAddress: toAddress,
      payoutWalletId: toWallet.id
    }

    if (EVM_CURRENCY_CODES[fromMainnetCode]) {
      if (router == null)
        throw new Error(`Missing router address for ${fromMainnetCode}`)
      if (thorAddress == null) {
        throw new Error('Invalid vault address')
      }

      memoType = 'hex'
      let assetAddress = '0x0000000000000000000000000000000000000000' // mainnet
      publicAddress = router

      if (fromTokenId != null) {
        if (sourceTokenContractAddress == null)
          throw new Error(
            `Missing sourceTokenContractAddress for ${fromMainnetCode}`
          )
        assetAddress = sourceTokenContractAddress

        // Token transactions send no ETH (or other EVM mainnet coin)
        ethNativeAmount = '0'

        // Check if token approval is required and return necessary data field
        approvalData = await getEvmApprovalData({
          contractAddress: router,
          assetAddress: sourceTokenContractAddress,
          nativeAmount: fromNativeAmount
        })
      }

      // Need to use ethers.js to craft a proper tx that calls Thorchain contract, then extract the data payload
      memo = await getDepositWithExpiryData({
        assetAddress,
        amountToSwapWei: Number(fromNativeAmount),
        contractAddress: router,
        vaultAddress: thorAddress,
        memo
      })
      memo = memo.replace(/^0x/, '')
    } else if (fromWallet.currencyInfo.pluginId === 'thorchainrune') {
      const makeTxParams: MakeTxParams = {
        type: 'MakeTxDeposit',
        assets: [
          {
            amount: fromNativeAmount,
            asset: 'THOR.RUNE',
            decimals: THOR_LIMIT_UNITS
          }
        ],
        memo,
        assetAction: { assetActionType: 'swap' },
        savedAction
      }

      // If this is a max quote. Call getMaxTx and modify the request
      if (quoteFor === 'max') {
        if (fromWallet.currencyInfo.pluginId !== 'thorchainrune') {
          throw new Error('fetchSwapQuoteInner max quote only for RUNE')
        }
        const maxNativeAmount = await fromWallet.otherMethods.getMaxTx(
          makeTxParams
        )
        return await fetchSwapQuoteInner(
          {
            ...request,
            nativeAmount: maxNativeAmount,
            quoteFor: 'from'
          },
          isEstimate
        )
      }

      return {
        canBePartial: false, // Partial quotes are disabled for now
        maxFulfillmentSeconds,
        request,
        makeTxParams,
        swapInfo,
        fromNativeAmount,
        expirationDate: new Date(Date.now() + EXPIRATION_MS)
      }
    } else {
      // For UTXO chains, we send the memo as text which gets
      // encoded by the plugins
      memoType = 'text'

      if (fromTokenId != null) {
        // Cannot yet do tokens on utxo chains
        throw new SwapCurrencyError(swapInfo, request)
      }
    }

    let preTx: EdgeTransaction | undefined
    if (approvalData != null) {
      const spendInfo: EdgeSpendInfo = {
        // Token approvals only spend the parent currency
        tokenId: null,
        memos: [
          {
            type: 'hex',
            value: approvalData
          }
        ],
        spendTargets: [
          {
            nativeAmount: '0',
            publicAddress: sourceTokenContractAddress
          }
        ],
        assetAction: {
          assetActionType: 'tokenApproval'
        },
        savedAction: {
          actionType: 'tokenApproval',
          tokenApproved: {
            pluginId: fromWallet.currencyInfo.pluginId,
            tokenId: fromTokenId,
            nativeAmount
          },
          tokenContractAddress: sourceTokenContractAddress ?? '',
          contractAddress: router ?? ''
        }
      }
      preTx = await request.fromWallet.makeSpend(spendInfo)
    }

    if (publicAddress == null) {
      throw new Error('Invalid publicAddress')
    }

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      memos: [
        {
          type: memoType,
          value: memo
        }
      ],
      spendTargets: [
        {
          nativeAmount: ethNativeAmount,
          publicAddress
        }
      ],
      assetAction: { assetActionType: 'swap' },
      savedAction,
      otherParams: {
        outputSort: 'targets'
      }
    }

    if (EVM_CURRENCY_CODES[fromMainnetCode]) {
      if (fromTokenId == null) {
        // For mainnet coins of EVM chains, use gasLimit override since makeSpend doesn't
        // know how to estimate an ETH spend with extra data
        const gasLimit = getGasLimit(fromMainnetCode, fromTokenId)
        if (gasLimit != null) {
          spendInfo.networkFeeOption = 'custom'
          spendInfo.customNetworkFee = {
            ...spendInfo.customNetworkFee,
            gasLimit
          }
        }
      }
    }

    return {
      canBePartial: false, // Partial quotes are disabled for now
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
      const { quoteFor, fromWallet } = request

      let swapOrder
      if (
        quoteFor === 'max' &&
        fromWallet.currencyInfo.pluginId === 'thorchainrune'
      ) {
        // fetchSwapQuoteInner has unique logic to handle 'max' quotes but
        // only when sending RUNE
        swapOrder = await fetchSwapQuoteInner(request, true)
      } else {
        const newRequest = await getMaxSwappable(
          fetchSwapQuoteInner,
          request,
          true
        )
        swapOrder = await fetchSwapQuoteInner(newRequest, true)
      }

      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

const getPool = (
  request: EdgeSwapRequestPlugin,
  swapInfo: EdgeSwapInfo,
  mainnetCode: string,
  tokenCode: string,
  pools: Pool[]
): Pool => {
  if (mainnetCode === 'THOR' && tokenCode === 'RUNE') {
    // Create a fake pool for rune. Use BTC pool to find rune USD price
    const btcPool = pools.find(pool => pool.asset === 'BTC.BTC')

    if (btcPool == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    const { assetPrice, assetPriceUSD } = btcPool
    const pool: Pool = {
      asset: 'THOR.RUNE',
      assetPrice: '1',
      assetPriceUSD: div18(assetPriceUSD, assetPrice)
    }
    return pool
  }

  const pool = pools.find(pool => {
    const [asset] = pool.asset.split('-')
    return asset === `${mainnetCode}.${tokenCode}`
  })
  if (pool == null) {
    throw new SwapCurrencyError(swapInfo, request)
  }
  return pool
}

const calcSwapFrom = async ({
  swapInfo,
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
  quoteFor,
  sourcePool,
  destPool,
  thorname,
  volatilitySpreadFinal,
  volatilitySpreadStreamingFinal,
  affiliateFeeBasis,
  streamingInterval,
  streamingQuantity
}: CalcSwapParams): Promise<CalcSwapResponse> => {
  // Max quotes start with getting a quote for 10 RUNE
  const fromNativeAmount = quoteFor === 'max' ? '1000000000' : nativeAmount

  // Get exchange rate from source to destination asset
  const fromExchangeAmount = await fromWallet.nativeToDenomination(
    fromNativeAmount,
    fromCurrencyCode
  )

  log(`fromExchangeAmount: ${fromExchangeAmount}`)

  const fromThorAmountDecimal = mul(fromExchangeAmount, THOR_LIMIT_UNITS)
  const fromThorAmount = round(fromThorAmountDecimal, 0)

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
    swapInfo,
    [noStreamParams, streamParams],
    fetch,
    thornodes,
    thornodesFetchOptions,
    fromWallet,
    fromCurrencyCode
  )

  const {
    inbound_address: thorAddress,
    memo: preMemo,
    router,
    streaming_swap_blocks: streamingSwapBlocks,
    total_swap_seconds: maxFulfillmentSeconds
  } = bestQuote
  const toThorAmount = getExpectedAmount(bestQuote)

  const canBePartial = !isEstimate || streamingSwapBlocks > 1

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

  const toExchangeAmount = div18(toThorAmountWithSpread, THOR_LIMIT_UNITS)
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
    // canBePartial,
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
  swapInfo,
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
  streamingQuantity
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
    div18(destPrice, sourcePrice)
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
    swapInfo,
    [noStreamParams, streamParams],
    fetch,
    thornodes,
    thornodesFetchOptions,
    fromWallet,
    fromCurrencyCode
  )

  const {
    inbound_address: thorAddress,
    memo: preMemo,
    router,
    streaming_swap_blocks: streamingSwapBlocks,
    total_swap_seconds: maxFulfillmentSeconds
  } = bestQuote

  const toThorAmount = getExpectedAmount(bestQuote)

  // If we get a streaming quote, this should be considered a fully executing
  // transaction since we don't put a slippage limit
  const canBePartial = !isEstimate || streamingSwapBlocks > 1

  // Get the percent drop from the 'to' amount the user wanted compared to the
  // 'to' amount returned by the API. Add that percent to the 'from' amount to
  // estimate how much more the user has to send.
  const feeRatio = div18(requestedToThorAmount, toThorAmount)
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

  const fromExchangeAmount = div18(fromThorAmountWithSpread, THOR_LIMIT_UNITS)
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
    // canBePartial,
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

const getBestQuote = async (
  swapInfo: EdgeSwapInfo,
  params: QueryParams[],
  fetch: EdgeFetchFunction,
  thornodes: string[],
  thornodesFetchOptions: EdgeFetchOptions,
  fromWallet: EdgeCurrencyWallet,
  fromCurrencyCode: string
): Promise<QuoteSwap> => {
  const quotes = await Promise.all(
    params.map(
      async p => await getQuote(p, fetch, thornodes, thornodesFetchOptions)
    )
  )

  let bestQuote: QuoteSwap | undefined
  let bestError: QuoteError | undefined
  for (const quote of quotes) {
    if (quote == null) continue
    if ('memo' in quote) {
      if (bestQuote == null) {
        bestQuote = quote
        continue
      }
      if (gt(getExpectedAmount(quote), getExpectedAmount(bestQuote))) {
        bestQuote = quote
      }
      continue
    }

    if ('error' in quote) {
      if (bestError == null) {
        bestError = quote
        continue
      }
      if (quote.error === 'SwapMinError') {
        if (quote.minThorAmount > bestError.minThorAmount) {
          bestError = quote
        }
      }
    }
  }

  if (bestQuote == null) {
    if (bestError == null) {
      throw new Error('Could not get quote')
    } else {
      const minExchangeAmount = div18(bestError.minThorAmount, THOR_LIMIT_UNITS)
      const minNativeAmount = await fromWallet.denominationToNative(
        minExchangeAmount,
        fromCurrencyCode
      )
      throw new SwapBelowLimitError(swapInfo, minNativeAmount, 'from')
    }
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
): Promise<QuoteSwapFull | undefined> => {
  const params = makeQueryParams(queryParams)

  try {
    const response = await fetchWaterfall(
      fetch,
      thornodes,
      `quote/swap?${params}`,
      thornodesFetchOptions
    )
    let json
    try {
      if (!response.ok) {
        const text = await response.text()
        if (text.includes('swap too small')) {
          // Get another quote just to retrieve the min amount.
          const amount: string = mul(String(queryParams.amount), '10')
          const newQueryParams = {
            ...queryParams,
            amount
          }
          const quoteSwap = await getQuote(
            newQueryParams,
            fetch,
            thornodes,
            thornodesFetchOptions
          )
          if (quoteSwap == null || 'error' in quoteSwap) return quoteSwap

          const { recommended_min_amount_in: minThorAmount } = quoteSwap
          return {
            error: 'SwapMinError',
            minThorAmount
          }
        }
        console.error(text)
        return
      } else {
        json = await response.json()
      }
    } catch (e) {
      console.error(String(e))
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
  chain: string,
  tokenId: string | null
): string | undefined => {
  if (EVM_CURRENCY_CODES[chain]) {
    if (tokenId == null) {
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
  fromTokenId: string | null
  fromCurrencyCode: string
  toPluginId: string
  toTokenId: string | null
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

/**
 * This will return the expected amount out from the quote maintaining backwards
 * compatibility with deprecated `expected_amount_out_streaming` field.
 */
function getExpectedAmount(quote: QuoteSwap): string {
  const amount =
    quote.expected_amount_out ?? quote.expected_amount_out_streaming
  if (amount == null) {
    throw new Error('Missing expected amount out from Thorchain API response')
  }
  return amount
}
