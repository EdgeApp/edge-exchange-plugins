import { gt, toFixed } from 'biggystring'
import {
  asArray,
  asJSON,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'

import { swapkit as swapkitMapping } from '../../../mappings/swapkit'
import {
  checkInvalidTokenIds,
  getMaxSwappable,
  makeSwapPluginQuote,
  mapToStringMap,
  SwapOrder
} from '../../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  fetchInfo,
  fetchWaterfall,
  getAddress,
  nativeToDenomination,
  promiseWithTimeout
} from '../../../util/utils'
import { EdgeSwapRequestPlugin } from '../../types'
import { createEvmApprovalEdgeTransactions } from '../defiUtils'
import {
  AFFILIATE_FEE_BASIS_DEFAULT,
  CHAIN_TYPE_MAP,
  EXCHANGE_INFO_UPDATE_FREQ_MS,
  EXPIRATION_MS,
  getGasLimit,
  INVALID_TOKEN_IDS
} from './thorchainCommon'

const pluginId = 'swapkitv3'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: true,
  displayName: 'SwapKit V3',
  supportEmail: 'support@edge.app'
}

// Network names that don't match parent network currency code
const MAINNET_CODE_TRANSCRIPTION: {
  [cc: string]: string
} = mapToStringMap(swapkitMapping)

// --------------------------------------------------------------------------
// V3 API Types and Cleaners
// --------------------------------------------------------------------------

/**
 * V3 Quote Request Parameters (Step 1 - Price Discovery)
 * Note: sourceAddress and destinationAddress are NOT required for initial quote
 * Note: affiliate info is inferred from API key - affiliateFee can override
 */
interface SwapKitV3QuoteParams {
  sellAsset: string
  buyAsset: string
  sellAmount: string
  slippage?: number
  affiliateFee?: number
  providers?: string[]
}

/**
 * V3 Swap Request Parameters (Step 2 - Transaction Building)
 * Requires routeId from quote response plus user addresses
 */
interface SwapKitV3SwapParams {
  routeId: string
  sourceAddress: string
  destinationAddress: string
  disableBalanceCheck?: boolean
  disableBuildTx?: boolean
}

// EVM transaction cleaner
const asEvmTx = asObject({
  data: asString
})

// Validates that a string contains an integer and returns it as a number.
// The SwapKit API currently returns Unix timestamps in seconds as integer
// strings (e.g., "1770165380"). Non-integer formats (e.g., decimals) will
// fail validation, causing asMaybe to return undefined and trigger fallback
// to the default expiration.
const asIntegerString = (raw: unknown): number => {
  const str = asString(raw)
  const num = Number(str)
  if (!Number.isInteger(num)) {
    throw new TypeError(`Expected integer string, got: ${str}`)
  }
  return num
}

// V3 Quote Route (from /v3/quote - no tx data, has routeId)
const asSwapKitV3QuoteRoute = asObject({
  routeId: asString,
  expectedBuyAmount: asString,
  expectedBuyAmountMaxSlippage: asOptional(asString),
  providers: asArray(asString),
  meta: asObject({
    approvalAddress: asOptional(asString),
    tags: asOptional(asArray(asString))
  }),
  expiration: asMaybe(asIntegerString)
})

// V3 Quote Response
const asSwapKitV3QuoteResponse = asObject({
  routes: asArray(asMaybe(asSwapKitV3QuoteRoute))
})

// V3 Swap Route (from /v3/swap - has tx data)
const asSwapKitV3SwapRoute = asObject({
  routeId: asString,
  expectedBuyAmount: asString,
  providers: asArray(asString),
  meta: asObject({
    approvalAddress: asOptional(asString)
  }),
  expiration: asMaybe(asIntegerString),
  targetAddress: asString,
  inboundAddress: asOptional(asString),
  memo: asOptional(asString),
  // Can also give a Cosmos tx, but we don't support that yet.
  // Can also give a UTXO tx, but their side doesn't support it without the
  // entirety of the source coming from one utxo.
  tx: asOptional(asEvmTx)
})

// V3 Swap Response - returns single route object directly
const asSwapKitV3SwapResponse = asSwapKitV3SwapRoute

type SwapKitV3QuoteRoute = ReturnType<typeof asSwapKitV3QuoteRoute>

// Exchange info cleaner
const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      swapkit: asObject({
        daVolatilitySpread: asOptional(asNumber),
        affiliateFeeBasis: asOptional(asString)
      })
    })
  })
})

const asInitOptions = asObject({
  appId: asOptional(asString, 'edge'),
  affiliateFeeBasis: asOptional(asString, AFFILIATE_FEE_BASIS_DEFAULT),
  thorswapApiKey: asOptional(asString)
})

/** Max slippage of 5% for estimated quotes */
const DA_VOLATILITY_SPREAD_DEFAULT = 0.05
const SWAPKIT_DEFAULT_SERVERS = ['https://api.swapkit.dev']

type ExchangeInfo = ReturnType<typeof asExchangeInfo>

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0

export function makeSwapKitV3Plugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)
  const { appId, thorswapApiKey } = initOptions

  const swapkitHeaders: Record<string, string | undefined> = {
    'Content-Type': 'application/json',
    'x-api-key': thorswapApiKey
  }

  // Filter out undefined header values
  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(swapkitHeaders)) {
      if (value != null) {
        headers[key] = value
      }
    }
    return headers
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const {
      fromCurrencyCode,
      toCurrencyCode,
      nativeAmount,
      fromWallet,
      fromTokenId,
      toWallet,
      toTokenId,
      quoteFor
    } = request
    // Do not support transfer between same assets
    if (
      fromWallet.currencyInfo.pluginId === toWallet.currencyInfo.pluginId &&
      request.fromTokenId === request.toTokenId
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    const reverseQuote = quoteFor === 'to'
    const isEstimate = true

    checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)

    // Grab addresses for the /v3/swap step
    const fromAddress = await getAddress(fromWallet)
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
          const responseText = await exchangeInfoResponse.text()
          exchangeInfo = asJSON(asExchangeInfo)(responseText)
          exchangeInfoLastUpdate = now
        } else {
          // Error is ok. We just use defaults
          log.warn('Error getting info server exchangeInfo. Using defaults...')
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn(
          'Error getting info server exchangeInfo. Using defaults...',
          message
        )
      }
    }

    const daVolatilitySpread =
      exchangeInfo?.swap.plugins.swapkit?.daVolatilitySpread ??
      DA_VOLATILITY_SPREAD_DEFAULT
    const affiliateFeeBasis =
      exchangeInfo?.swap.plugins.swapkit?.affiliateFeeBasis ??
      initOptions.affiliateFeeBasis

    // Reverse quotes not supported
    if (reverseQuote) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const sellAmount = nativeToDenomination(
      fromWallet,
      nativeAmount,
      fromTokenId
    )

    const sellAsset =
      `${fromMainnetCode}.${fromCurrencyCode}` +
      (fromTokenId != null ? `-0x${fromTokenId}` : '')
    const buyAsset =
      `${toMainnetCode}.${toCurrencyCode}` +
      (toTokenId != null ? `-0x${toTokenId}` : '')

    // --------------------------------------------------------------------------
    // STEP 1: Get Quote (Price Discovery - no addresses needed)
    // Note: Affiliate identity is tied to API key in V3, affiliateFee can override
    // --------------------------------------------------------------------------
    const quoteParams: SwapKitV3QuoteParams = {
      sellAsset,
      buyAsset,
      sellAmount,
      slippage: daVolatilitySpread * 100,
      affiliateFee: parseInt(affiliateFeeBasis),
      providers: ['THORCHAIN', 'MAYACHAIN']
    }

    const quoteResponse = await fetchWaterfall(
      fetchCors,
      SWAPKIT_DEFAULT_SERVERS,
      'v3/quote',
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(quoteParams)
      }
    )

    if (!quoteResponse.ok) {
      const responseText = await quoteResponse.text()
      if (responseText.includes('No routes found')) {
        log.warn('No routes found')
        throw new SwapCurrencyError(swapInfo, request)
      }
      throw new Error(`SwapKit v3/quote failed: ${responseText}`)
    }

    const quoteResponseText = await quoteResponse.text()
    const quoteData = asJSON(asSwapKitV3QuoteResponse)(quoteResponseText)

    const validRoutes = quoteData.routes.filter(
      (r): r is SwapKitV3QuoteRoute => r != null
    )

    // Find the best route that uses THORCHAIN or MAYACHAIN
    const selectedRoute = validRoutes
      .sort((a, b) => (gt(a.expectedBuyAmount, b.expectedBuyAmount) ? -1 : 1))
      .find(
        route =>
          route.providers.includes('THORCHAIN') ||
          route.providers.includes('MAYACHAIN')
      )

    if (selectedRoute == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const { routeId, expectedBuyAmount, providers, expiration } = selectedRoute

    const toNativeAmount = toFixed(
      denominationToNative(toWallet, expectedBuyAmount, toTokenId),
      0,
      0
    )

    let memoType: EdgeMemo['type'] = 'hex'
    let memo = ''
    let publicAddress = ''
    const preTxs: EdgeTransaction[] = []
    const sourceTokenContractAddress =
      fromTokenId != null ? `0x${fromTokenId}` : undefined

    // --------------------------------------------------------------------------
    // Check chain type and call /v3/swap
    // --------------------------------------------------------------------------
    const chainType = CHAIN_TYPE_MAP[fromMainnetCode]

    // Only support EVM and UTXO chains
    if (chainType !== 'evm' && chainType !== 'utxo') {
      log.warn(`Chain type '${chainType}' not supported for ${fromMainnetCode}`)
      throw new SwapCurrencyError(swapInfo, request)
    }

    // UTXO chains don't support tokens
    if (chainType === 'utxo' && fromTokenId != null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Call /v3/swap
    // - disableBalanceCheck: skip SwapKit's balance validation
    // - disableBuildTx: skip tx building (needed for UTXO to avoid bitcoinjs-lib balance check)
    const swapParams: SwapKitV3SwapParams = {
      routeId,
      sourceAddress: fromAddress,
      destinationAddress: toAddress,
      disableBalanceCheck: true,
      disableBuildTx: chainType === 'utxo'
    }

    const swapResponse = await fetchWaterfall(
      fetchCors,
      SWAPKIT_DEFAULT_SERVERS,
      'v3/swap',
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(swapParams)
      }
    )

    if (!swapResponse.ok) {
      const responseText = await swapResponse.text()
      throw new Error(`SwapKit v3/swap failed: ${responseText}`)
    }

    const swapResponseText = await swapResponse.text()
    const swapRoute = asJSON(asSwapKitV3SwapResponse)(swapResponseText)

    publicAddress = swapRoute.targetAddress

    if (chainType === 'evm') {
      // --------------------------------------------------------------------------
      // EVM chain: Use tx.data as memo
      // --------------------------------------------------------------------------
      const evmTransaction = asMaybe(asEvmTx)(swapRoute.tx)
      if (evmTransaction == null) {
        throw new Error('Missing EVM transaction data from SwapKit')
      }

      if (fromMainnetCode !== fromCurrencyCode) {
        // Token swap - need approval
        if (sourceTokenContractAddress == null) {
          throw new Error(
            `Missing sourceTokenContractAddress for ${fromMainnetCode}`
          )
        }

        const approvalAddress = swapRoute.meta.approvalAddress
        if (approvalAddress == null) {
          throw new Error('Missing approvalAddress for token swap')
        }

        const approvalTxs = await createEvmApprovalEdgeTransactions({
          request,
          approvalAmount: nativeAmount,
          tokenContractAddress: sourceTokenContractAddress,
          recipientAddress: approvalAddress,
          networkFeeOption: 'high'
        })
        preTxs.push(...approvalTxs)
      }
      memo = evmTransaction.data.replace(/^0x/, '')
    } else {
      // --------------------------------------------------------------------------
      // UTXO chain: Use memo from response
      // --------------------------------------------------------------------------
      if (swapRoute.memo == null) {
        throw new Error('Missing memo for UTXO swap')
      }

      memo = swapRoute.memo
      memoType = 'text'
    }

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount,
          publicAddress
        }
      ],
      networkFeeOption: 'high',
      assetAction: {
        assetActionType: 'swap'
      },
      memos: [{ type: memoType, value: memo }],
      savedAction: {
        actionType: 'swap',
        swapInfo,
        isEstimate,
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
        payoutWalletId: toWallet.id,
        refundAddress: fromAddress
      },
      otherParams: {
        outputSort: 'targets'
      }
    }

    if (chainType === 'evm') {
      if (fromMainnetCode === fromCurrencyCode) {
        // For mainnet coins of EVM chains, use gasLimit override since makeSpend doesn't
        // know how to estimate an ETH spend with extra data
        const gasLimit = getGasLimit(fromMainnetCode, fromTokenId)
        if (gasLimit != null) {
          spendInfo.customNetworkFee = {
            ...spendInfo.customNetworkFee,
            gasLimit
          }
        }
      }
    }

    const providersStr = providers.join(' -> ')
    const notes = `DEX Providers: ${providersStr}`

    // Use expiration from quote if valid, fall back to default (60s)
    const expirationMs =
      expiration != null ? expiration * 1000 : Date.now() + EXPIRATION_MS

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: nativeAmount,
      expirationDate: new Date(expirationMs),
      preTxs,
      metadataNotes: notes
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      const newRequest = await getMaxSwappable(fetchSwapQuoteInner, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}
