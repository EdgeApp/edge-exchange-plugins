import { gt, lt } from 'biggystring'
import {
  asArray,
  asBoolean,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { swapsxyz as swapsxyzMapping } from '../../mappings/swapsxyz'
import {
  getMaxSwappable,
  makeSwapPluginQuote,
  mapToStringMap,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, makeQueryParams } from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'
import { createEvmApprovalEdgeTransactions } from './defiUtils'

const pluginId = 'swapsxyz'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: true,
  displayName: 'swaps.xyz',
  supportEmail: 'support@edge.app'
}

const asInitOptions = asObject({
  apiKey: asString
})

const SWAPSXYZ_API_URL = 'https://api-v2.swaps.xyz/api'
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'
// swaps.xyz quotes are time-sensitive on-chain routes; keep them short-lived.
const EXPIRATION_MS = 1000 * 60
// 1% (100 basis points) default slippage, matching the app's DEX default.
const SLIPPAGE_BPS = '100'
// swaps.xyz explorer base for the saved swap action.
const ORDER_URI = 'https://explorer.swaps.xyz/tx/'

// Maps EdgeCurrencyPluginId -> swaps.xyz numeric chainId (as a string).
const MAINNET_CODE_TRANSCRIPTION: StringMap = mapToStringMap(swapsxyzMapping)

const asSwapsXyzTx = asObject({
  to: asString,
  data: asString,
  value: asString,
  chainId: asNumber
})

const asSwapsXyzAmount = asObject({
  amount: asString,
  address: asString,
  chainId: asNumber,
  isNative: asBoolean,
  decimals: asNumber,
  symbol: asString
})

const asSwapsXyzAction = asObject({
  tx: asSwapsXyzTx,
  txId: asString,
  amountIn: asSwapsXyzAmount,
  amountOut: asSwapsXyzAmount,
  amountOutMin: asSwapsXyzAmount,
  vmId: asString,
  requiresTokenApproval: asBoolean,
  executionsType: asString
})

/**
 * `getPaths` amount limits. Both fields are base-unit strings on the SOURCE
 * token (the same units as the request's `nativeAmount`), and are `null`
 * whenever the route carries no limit.
 */
const asSwapsXyzAmountLimits = asObject({
  minAmount: asOptional(asString),
  maxAmount: asOptional(asString)
})

const asSwapsXyzPath = asObject({
  chainId: asNumber,
  supportsExactAmountIn: asOptional(asBoolean, true),
  amountLimits: asOptional(asSwapsXyzAmountLimits)
})

const asSwapsXyzPaths = asObject({
  srcToken: asSwapsXyzAmountLimits,
  paths: asArray(asSwapsXyzPath)
})

const asSwapsXyzError = asObject({
  success: asValue(false),
  error: asObject({
    code: asString,
    name: asOptional(asString, ''),
    message: asOptional(asString, ''),
    statusCode: asOptional(asNumber)
  })
})

export type SwapsXyzAction = ReturnType<typeof asSwapsXyzAction>
type SwapsXyzError = ReturnType<typeof asSwapsXyzError>

/**
 * Context resolved from the swap request, passed to the pure spend-info
 * builder so it can be unit tested without a wallet or network.
 */
export interface SwapsXyzSpendContext {
  action: SwapsXyzAction
  fromPluginId: string
  toPluginId: string
  fromTokenId: string | null
  toTokenId: string | null
  fromAddress: string
  toAddress: string
  toWalletId: string
}

/**
 * Turn a parsed swaps.xyz `getAction` response into the EVM `EdgeSpendInfo`
 * that executes the swap. The returned tx sends `tx.data` calldata to the
 * router at `tx.to`; for a native source the router needs `tx.value`, and for
 * an ERC20 source the caller must first approve `tx.to` (see the plugin's
 * `fetchSwapQuoteInner`). Pure and synchronous for testability.
 */
export const makeSwapsXyzSpendInfo = (
  context: SwapsXyzSpendContext
): EdgeSpendInfo => {
  const {
    action,
    fromPluginId,
    toPluginId,
    fromTokenId,
    toTokenId,
    fromAddress,
    toAddress,
    toWalletId
  } = context
  const { tx, txId, amountIn, amountOut } = action

  // For a native source the wallet must send `tx.value`; for a token source
  // the router pulls the approved amount and the tx itself carries no value.
  const fromNativeAmount = fromTokenId == null ? tx.value : amountIn.amount

  const spendInfo: EdgeSpendInfo = {
    tokenId: fromTokenId,
    spendTargets: [
      {
        nativeAmount: fromNativeAmount,
        publicAddress: tx.to
      }
    ],
    memos: [{ type: 'hex', value: tx.data.replace(/^0x/, '') }],
    networkFeeOption: 'high',
    assetAction: {
      assetActionType: 'swap'
    },
    savedAction: {
      actionType: 'swap',
      swapInfo,
      orderId: txId,
      orderUri: ORDER_URI + txId,
      isEstimate: true,
      toAsset: {
        pluginId: toPluginId,
        tokenId: toTokenId,
        nativeAmount: amountOut.amount
      },
      fromAsset: {
        pluginId: fromPluginId,
        tokenId: fromTokenId,
        nativeAmount: amountIn.amount
      },
      payoutAddress: toAddress,
      payoutWalletId: toWalletId,
      refundAddress: fromAddress
    }
  }
  return spendInfo
}

const CURRENCY_ERROR_KEYWORDS = [
  'TOKEN',
  'CHAIN',
  'ROUTE',
  'PATH',
  'PAIR',
  'UNSUPPORTED',
  'NOT_FOUND',
  'NO_QUOTE'
]

// Checked BEFORE the currency keywords, since a limit failure often names the
// route or token too ("amount too low for this route") and the limit is the
// more specific, more useful error. Kept as whole phrases rather than bare
// substrings: 'LOW' alone also matches ALLOWANCE, 'MIN' matches TERMINATED.
const BELOW_LIMIT_KEYWORDS = [
  'TOO_LOW',
  'TOO LOW',
  'TOO_SMALL',
  'TOO SMALL',
  'MINIMUM',
  'BELOW'
]
const ABOVE_LIMIT_KEYWORDS = [
  'TOO_HIGH',
  'TOO HIGH',
  'TOO_LARGE',
  'TOO LARGE',
  'MAXIMUM',
  'EXCEED',
  'ABOVE'
]

/** Translate a swaps.xyz error response into the closest Edge swap error. */
const throwSwapsXyzError = (
  swapError: SwapsXyzError,
  request: EdgeSwapRequestPlugin,
  endpoint: string
): never => {
  const { code, message } = swapError.error
  const upper = `${code} ${message}`.toUpperCase()

  if (BELOW_LIMIT_KEYWORDS.some(keyword => upper.includes(keyword))) {
    throw new SwapBelowLimitError(swapInfo, undefined, 'from')
  }
  if (ABOVE_LIMIT_KEYWORDS.some(keyword => upper.includes(keyword))) {
    throw new SwapAboveLimitError(swapInfo, undefined, 'from')
  }
  if (CURRENCY_ERROR_KEYWORDS.some(keyword => upper.includes(keyword))) {
    throw new SwapCurrencyError(swapInfo, request)
  }
  throw new Error(
    `swaps.xyz ${endpoint} failed: ${code}${
      message !== '' ? ` (${message})` : ''
    }`
  )
}

export function makeSwapsXyzPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io } = opts
  const { apiKey } = asInitOptions(opts.initOptions)
  const { fetchCors = io.fetch } = io

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    isMaxRequest: boolean = false
  ): Promise<SwapOrder> => {
    const {
      fromTokenId,
      toTokenId,
      nativeAmount,
      fromWallet,
      toWallet,
      quoteFor
    } = request

    // swaps.xyz `getAction` builds a route for an exact source amount.
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromPluginId = fromWallet.currencyInfo.pluginId
    const toPluginId = toWallet.currencyInfo.pluginId

    // Reject same-asset transfers; there is nothing to swap.
    if (fromPluginId === toPluginId && fromTokenId === toTokenId) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromChainId = MAINNET_CODE_TRANSCRIPTION[fromPluginId]
    const toChainId = MAINNET_CODE_TRANSCRIPTION[toPluginId]
    if (fromChainId == null || toChainId == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Resolve the on-chain token addresses (native currency uses the zero
    // address; tokens use their contract address).
    const fromToken = fromWallet.currencyConfig.allTokens[fromTokenId ?? '']
    const toToken = toWallet.currencyConfig.allTokens[toTokenId ?? '']
    const fromTokenAddress =
      fromTokenId == null
        ? NATIVE_TOKEN_ADDRESS
        : fromToken?.networkLocation?.contractAddress
    const toTokenAddress =
      toTokenId == null
        ? NATIVE_TOKEN_ADDRESS
        : toToken?.networkLocation?.contractAddress
    if (fromTokenAddress == null || toTokenAddress == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // `getPaths` answers two questions `getAction` only answers by failing:
    // whether a route exists at all for this pair, and what its usable amount
    // limits are. Asking first turns an unsupported pair or an out-of-bounds
    // amount into the right typed error, which the core ranks against the
    // other providers, instead of a generic route failure.
    const pathsParams = makeQueryParams({
      srcChainId: fromChainId,
      srcToken: fromTokenAddress,
      dstChainId: toChainId,
      dstToken: toTokenAddress
    })
    const pathsResponse = await fetchCors(
      `${SWAPSXYZ_API_URL}/getPaths?${pathsParams}`,
      { headers }
    )
    const pathsJson = await pathsResponse.json()

    const pathsError = asMaybe(asSwapsXyzError)(pathsJson)
    if (pathsError != null) {
      throwSwapsXyzError(pathsError, request, 'getPaths')
    }
    if (!pathsResponse.ok) {
      throw new Error(
        `swaps.xyz getPaths failed with status ${pathsResponse.status}`
      )
    }

    const { srcToken, paths } = asSwapsXyzPaths(pathsJson)
    // An unsupported chain or token pair comes back as HTTP 200 with an empty
    // `paths` array, not as an error body.
    const path = paths.find(entry => entry.chainId === Number(toChainId))
    if (path == null || !path.supportsExactAmountIn) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Route limits win over the source token's own limits when both exist.
    const minAmount = path.amountLimits?.minAmount ?? srcToken.minAmount
    const maxAmount = path.amountLimits?.maxAmount ?? srcToken.maxAmount
    if (minAmount != null && lt(nativeAmount, minAmount)) {
      throw new SwapBelowLimitError(swapInfo, minAmount, 'from')
    }
    // A `max` request reaches here as a `from` quote for the entire balance, so
    // a wallet richer than the route's ceiling should quote AT that ceiling.
    // Only an explicit amount above it is an error.
    let swapAmount = nativeAmount
    if (maxAmount != null && gt(swapAmount, maxAmount)) {
      if (!isMaxRequest) {
        throw new SwapAboveLimitError(swapInfo, maxAmount, 'from')
      }
      swapAmount = maxAmount
    }

    const fromAddress = await getAddress(fromWallet)
    const toAddress = await getAddress(toWallet)

    const params = makeQueryParams({
      actionType: 'swap-action',
      sender: fromAddress,
      recipient: toAddress,
      refundTo: fromAddress,
      srcChainId: fromChainId,
      srcToken: fromTokenAddress,
      dstChainId: toChainId,
      dstToken: toTokenAddress,
      amount: swapAmount,
      swapDirection: 'exact-amount-in',
      slippage: SLIPPAGE_BPS
    })

    const response = await fetchCors(
      `${SWAPSXYZ_API_URL}/getAction?${params}`,
      {
        headers
      }
    )
    const responseJson = await response.json()

    const swapError = asMaybe(asSwapsXyzError)(responseJson)
    if (swapError != null) {
      throwSwapsXyzError(swapError, request, 'getAction')
    }
    if (!response.ok) {
      throw new Error(
        `swaps.xyz getAction failed with status ${response.status}`
      )
    }

    const action = asSwapsXyzAction(responseJson)

    // This plugin only executes EVM calldata; other VMs (solana, tron,
    // alt-vm, hypercore) and gasless flows are not supported here.
    if (action.vmId !== 'evm' || action.executionsType !== 'DEFAULT') {
      throw new SwapCurrencyError(swapInfo, request)
    }
    // A zero output means the amount is below the route's usable minimum.
    if (action.amountOut.amount === '0' || action.amountOutMin.amount === '0') {
      throw new SwapBelowLimitError(swapInfo, undefined, 'from')
    }
    // The spend and the ERC20 approval below are built from response fields, so
    // never let the response authorize MORE of the source asset than was asked
    // for. `amountIn` is always in the SOURCE asset's units, so it always
    // compares; `tx.value` is native wei, comparable only when the source IS
    // the native asset. On a token route `tx.value` is a protocol fee in a
    // different unit, so comparing it there would reject valid quotes.
    if (
      gt(action.amountIn.amount, swapAmount) ||
      (fromTokenId == null && gt(action.tx.value, swapAmount))
    ) {
      throw new Error(
        'swaps.xyz getAction returned a source amount above the requested amount'
      )
    }

    // ERC20 sources must approve the router (`tx.to`) before the swap.
    const preTxs: EdgeTransaction[] = []
    if (fromTokenId != null && action.requiresTokenApproval) {
      const approvalTxs = await createEvmApprovalEdgeTransactions({
        request,
        approvalAmount: action.amountIn.amount,
        tokenContractAddress: fromTokenAddress,
        recipientAddress: action.tx.to,
        networkFeeOption: 'high'
      })
      preTxs.push(...approvalTxs)
    }

    const spendInfo = makeSwapsXyzSpendInfo({
      action,
      fromPluginId,
      toPluginId,
      fromTokenId,
      toTokenId,
      fromAddress,
      toAddress,
      toWalletId: toWallet.id
    })

    return {
      expirationDate: new Date(Date.now() + EXPIRATION_MS),
      fromNativeAmount: swapAmount,
      metadataNotes: 'DEX Provider: swaps.xyz',
      minReceiveAmount: action.amountOutMin.amount,
      preTxs,
      request,
      spendInfo,
      swapInfo
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      const isMaxRequest = request.quoteFor === 'max'
      let newRequest = request
      if (isMaxRequest) {
        if (request.fromTokenId != null) {
          const maxAmount =
            request.fromWallet.balanceMap.get(request.fromTokenId) ?? '0'
          newRequest = {
            ...request,
            nativeAmount: maxAmount,
            quoteFor: 'from'
          }
        } else {
          newRequest = await getMaxSwappable(
            async r => await fetchSwapQuoteInner(r, true),
            request
          )
        }
      }
      const swapOrder = await fetchSwapQuoteInner(newRequest, isMaxRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}
