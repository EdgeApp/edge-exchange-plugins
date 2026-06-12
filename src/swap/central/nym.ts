import { gt, lt } from 'biggystring'
import {
  asArray,
  asDate,
  asMaybe,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
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

import { nym as nymMapping } from '../../mappings/nym'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getContractAddresses,
  getMaxSwappable,
  makeSwapPluginQuote,
  mapToRecord,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'

// Swap plugin id. Distinct from the `nym` *currency* plugin id (edge-core-js
// keys all plugins in one namespace), mirroring how the Thorchain swap plugin
// (`thorchain`) differs from the `thorchainrune` currency plugin.
const pluginId = 'nymswap'

// Edge pluginId of the NYM *asset/currency*. NYM provides its own liquidity, so
// every swap must have the NYM asset on one side (enforced below).
const NYM_PLUGIN_ID = 'nym'

// Chains whose deposit/payout address must be a specific address type. Zcash
// swaps require the transparent address rather than the default (shielded).
const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'NYM',
  supportEmail: 'support@nymtech.net'
}

const asInitOptions = asObject({
  apiKey: asString
})

// NYM is testnet-only for now. This base URL must be updated to the production
// endpoint when NYM goes live (see CHANGELOG / Asana task).
const NYM_API_BASE = 'https://nym-swap-testnet-api.nymte.ch'
// User-facing order-tracking page. Built from this trusted constant rather than
// the partner-supplied `statusUrl`, so a compromised upstream cannot inject an
// attacker-controlled host/scheme into the saved swap action.
const ORDER_URI = 'https://nym-swap-testnet.nymte.ch/orderStatus/'

const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  nymMapping
)

/**
 * NYM asset reference, mirroring Edge's own asset model. `chainNetwork` is the
 * NYM network-family name, `chainId` is the EVM chain id (omitted for non-EVM
 * chains), and `tokenId` is the 0x contract address (null for a native asset).
 */
interface NymAssetRef {
  chainNetwork: string
  chainId?: number
  tokenId: string | null
}

const asNymQuote = asObject({
  quoteId: asString,
  sourceAmount: asString,
  destinationAmount: asString,
  rate: asString,
  expiresAt: asDate,
  minSourceAmount: asString,
  maxSourceAmount: asString,
  minDestinationAmount: asString,
  maxDestinationAmount: asString
})

const asNymOrder = asObject({
  orderId: asString,
  status: asString,
  payinAddress: asString,
  payinExtraId: asOptional(asString),
  expiresAt: asDate
  // `statusUrl` is intentionally not consumed: the order-tracking URL is built
  // from the trusted ORDER_URI constant to avoid trusting a partner-supplied
  // host/scheme.
})

// Error bodies come in two shapes:
//   { errors: [{ error: 'InvalidRequest' | 'AssetNotSupported', message }] }
//   { error: 'Quote rate limit exceeded ...' }
const asNymErrorArray = asObject({
  errors: asArray(asObject({ error: asString, message: asOptional(asString) }))
})
const asNymSimpleError = asObject({ error: asString })

/**
 * Builds a NYM asset reference from an Edge wallet. `contractAddress` is the
 * token's 0x contract address (undefined for a native asset). Returns null if
 * the wallet's chain is not mapped to a NYM `chainNetwork`.
 */
const getAssetRef = (
  wallet: EdgeCurrencyWallet,
  contractAddress: string | undefined
): NymAssetRef | null => {
  const chainNetwork =
    MAINNET_CODE_TRANSCRIPTION[
      wallet.currencyInfo.pluginId as EdgeCurrencyPluginId
    ]
  if (chainNetwork == null) return null

  const evmChainId = wallet.currencyInfo.evmChainId
  return {
    chainNetwork,
    ...(evmChainId != null ? { chainId: evmChainId } : {}),
    tokenId: contractAddress ?? null
  }
}

export function makeNymPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { apiKey } = asInitOptions(opts.initOptions)
  const fetchCors = io.fetchCors ?? io.fetch

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-api-key': apiKey
  }

  /**
   * Maps a non-OK NYM response to the appropriate swap error. Bodies are parsed
   * when present; otherwise classification falls back to the status code.
   */
  const handleErrorResponse = async (
    response: { status: number; text: () => Promise<string> },
    request: EdgeSwapRequestPlugin,
    stage: 'quote' | 'order'
  ): Promise<never> => {
    const text = await response.text().catch(() => '')
    log.warn(`NYM ${stage} error ${response.status}: ${text}`)

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e: unknown) {
      parsed = undefined
    }

    const errorArray = asMaybe(asNymErrorArray)(parsed)
    if (errorArray != null) {
      const message = errorArray.errors
        .map(e => e.message ?? e.error)
        .join('; ')
      // Region / geographic restriction.
      if (/region|geo|country|blocked|jurisdiction/i.test(message)) {
        throw new SwapPermissionError(swapInfo, 'geoRestriction')
      }
      // Unsupported asset or pair/direction (e.g. selling NYM to a UTXO chain).
      throw new SwapCurrencyError(swapInfo, request)
    }

    // 403 with no parsable error body: treat as a permission restriction.
    if (response.status === 403) {
      throw new SwapPermissionError(swapInfo, 'geoRestriction')
    }

    // { error: 'message' } (e.g. 429 rate limiting) or anything else: transient.
    const simpleError = asMaybe(asNymSimpleError)(parsed)
    throw new Error(
      `NYM ${stage} returned error code ${response.status}${
        simpleError != null ? `: ${simpleError.error}` : ''
      }`
    )
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor } = request

    // NYM provides its own liquidity: one side of the swap must be NYM. Gate
    // locally so unrelated pairs never reach (and rate-limit) the API.
    if (
      fromWallet.currencyInfo.pluginId !== NYM_PLUGIN_ID &&
      toWallet.currencyInfo.pluginId !== NYM_PLUGIN_ID
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // NYM identifies tokens by their 0x contract address, not the Edge tokenId.
    const { fromContractAddress, toContractAddress } = getContractAddresses(
      request
    )

    const from = getAssetRef(fromWallet, fromContractAddress)
    const to = getAssetRef(toWallet, toContractAddress)
    if (from == null || to == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Grab addresses:
    const [refundAddress, payoutAddress] = await Promise.all([
      getAddress(fromWallet, addressTypeMap[fromWallet.currencyInfo.pluginId]),
      getAddress(toWallet, addressTypeMap[toWallet.currencyInfo.pluginId])
    ])

    // NYM amounts are in native units (matching Edge's nativeAmount), so no
    // denomination conversion is required.
    const quoteBody =
      quoteFor === 'to'
        ? { from, to, destinationAmount: request.nativeAmount }
        : { from, to, sourceAmount: request.nativeAmount }

    const quoteResponse = await fetchCors(
      `${NYM_API_BASE}/api/partner/v1/quote`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(quoteBody)
      }
    )

    if (!quoteResponse.ok) {
      await handleErrorResponse(quoteResponse, request, 'quote')
    }

    const quote = asNymQuote(await quoteResponse.json())

    // Enforce the min/max limits returned by the quote against the user's
    // requested amount (NYM returns native-unit limits for both sides).
    // Compare `request.nativeAmount`, not the quote's echoed amount, so a
    // clamped quote that omits an error still trips the limit error.
    if (quoteFor === 'to') {
      if (lt(request.nativeAmount, quote.minDestinationAmount)) {
        throw new SwapBelowLimitError(
          swapInfo,
          quote.minDestinationAmount,
          'to'
        )
      }
      if (gt(request.nativeAmount, quote.maxDestinationAmount)) {
        throw new SwapAboveLimitError(
          swapInfo,
          quote.maxDestinationAmount,
          'to'
        )
      }
    } else {
      if (lt(request.nativeAmount, quote.minSourceAmount)) {
        throw new SwapBelowLimitError(swapInfo, quote.minSourceAmount, 'from')
      }
      if (gt(request.nativeAmount, quote.maxSourceAmount)) {
        throw new SwapAboveLimitError(swapInfo, quote.maxSourceAmount, 'from')
      }
    }

    // Create the order from the quote:
    const orderResponse = await fetchCors(
      `${NYM_API_BASE}/api/partner/v1/order`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          quoteId: quote.quoteId,
          payoutAddress,
          refundAddress
        })
      }
    )

    if (!orderResponse.ok) {
      await handleErrorResponse(orderResponse, request, 'order')
    }

    const order = asNymOrder(await orderResponse.json())

    const fromNativeAmount = quote.sourceAmount
    const toNativeAmount = quote.destinationAmount

    const memos: EdgeMemo[] =
      order.payinExtraId == null || order.payinExtraId === ''
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: order.payinExtraId
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: order.payinAddress
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
        orderId: order.orderId,
        orderUri: ORDER_URI + order.orderId,
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
        payoutAddress,
        payoutWalletId: toWallet.id,
        refundAddress
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: ensureInFuture(order.expiresAt)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

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
