import { gt, lt, round } from 'biggystring'
import {
  asArray,
  asDate,
  asEither,
  asMaybe,
  asNull,
  asNumber,
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
  EdgeTokenId,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { houdini as houdiniMapping } from '../../mappings/houdini'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getContractAddresses,
  makeSwapPluginQuote,
  mapToRecord,
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

const pluginId = 'houdini'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'HoudiniSwap',
  supportEmail: 'support@houdiniswap.com'
}

// Houdini's v2 partner API. Note the auth header is `Authorization: <key>:<secret>`
// (no `Bearer`); every endpoint returns 402 without it.
const asInitOptions = asObject({
  apiKey: asString,
  apiSecret: asString
})

const orderUri = 'https://houdiniswap.com/order/'
const uri = 'https://api-partner.houdiniswap.com/v2/'

// Houdini quotes/exchanges are keyed by an opaque token id, so destination
// addresses pass straight through. Zcash is the lone exception: Houdini only
// accepts transparent `t1` addresses, mirroring how ChangeNow special-cases it.
const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

/**
 * Edge `EdgeCurrencyPluginId` -> Houdini chain `shortName`. Chains that Houdini
 * cannot serve, or that require a deposit memo the prototype does not yet plumb,
 * map to `null` and are rejected up front by `checkWhitelistedMainnetCodes`.
 */
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  houdiniMapping
)

const asHoudiniToken = asObject({
  id: asString,
  address: asEither(asNull, asString),
  chain: asString
})

const asHoudiniTokensResponse = asObject({
  tokens: asArray(asMaybe(asHoudiniToken))
})

const asHoudiniQuote = asObject({
  quoteId: asString,
  type: asString,
  amountOut: asNumber,
  amountIn: asOptional(asNumber),
  min: asOptional(asNumber),
  max: asOptional(asNumber),
  validUntil: asOptional(asString)
})

const asHoudiniQuotesResponse = asObject({
  quotes: asArray(asMaybe(asHoudiniQuote))
})

const asHoudiniOrder = asObject({
  houdiniId: asString,
  depositAddress: asString,
  depositTag: asOptional(asString),
  expires: asOptional(asDate),
  inAmount: asNumber,
  outAmount: asNumber
})

/**
 * Convert a JSON float to a decimal string, expanding any scientific notation
 * (Houdini returns amounts as BSON doubles, so very small/large values can come
 * back as e.g. `2.53e-05`). biggystring needs a plain decimal string.
 */
function floatToDecimalString(value: number): string {
  if (!isFinite(value)) return '0'
  const str = String(value)
  if (!str.includes('e') && !str.includes('E')) return str
  return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Convert a provider float in display units to a whole-atomic-unit native
 * string. Houdini amounts can carry more decimals than the asset supports, so
 * the result is rounded to an integer to satisfy Edge's native-amount contract.
 */
function floatToNativeAmount(
  wallet: EdgeCurrencyWallet,
  value: number,
  tokenId: EdgeTokenId
): string {
  return round(
    denominationToNative(wallet, floatToDecimalString(value), tokenId),
    0
  )
}

export function makeHoudiniPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey, apiSecret } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `${apiKey}:${apiSecret}`
  }

  // Houdini's partner API is server-to-server and rejects browser-origin
  // requests: the core runs plugins inside a WebView, so `io.fetch` carries an
  // Origin / Sec-Fetch-* header set that Houdini answers with HTTP 403. Force
  // Edge's CORS proxy (`corsBypass: 'always'`) so each call is made host-side,
  // matching the server-to-server contract the API expects.
  const corsBypass = 'always' as const

  // Memoize chain -> (addressKey -> tokenId) lookups so repeat quotes on the
  // same assets do not re-hit `GET /tokens`.
  const tokenIdCache = new Map<string, string>()

  async function resolveTokenId(
    chain: string,
    contractAddress: string | undefined
  ): Promise<string | undefined> {
    const addressKey = contractAddress?.toLowerCase() ?? 'native'
    const cacheKey = `${chain}:${addressKey}`
    const cached = tokenIdCache.get(cacheKey)
    if (cached != null) return cached

    const query =
      contractAddress != null
        ? `tokens?chain=${chain}&address=${contractAddress}&pageSize=100`
        : `tokens?chain=${chain}&mainnet=true&pageSize=100`
    const response = await fetchCors(uri + query, { headers, corsBypass })
    if (!response.ok) {
      const text = await response.text()
      log.warn('Houdini tokens lookup error:', text)
      return undefined
    }
    const { tokens } = asHoudiniTokensResponse(await response.json())

    const match = tokens.find(token => {
      if (token == null || token.chain !== chain) return false
      if (contractAddress == null) return token.address == null
      return token.address?.toLowerCase() === addressKey
    })
    if (match == null) return undefined

    tokenIdCache.set(cacheKey, match.id)
    return match.id
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor, nativeAmount } = request

    // The prototype only supports forward ("from") quotes. Houdini's quote
    // endpoint always prices the `from` amount, so reverse and max quotes are a
    // follow-up.
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromMainnet =
      MAINNET_CODE_TRANSCRIPTION[
        fromWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
      ]
    const toMainnet =
      MAINNET_CODE_TRANSCRIPTION[
        toWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
      ]
    if (fromMainnet == null || toMainnet == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const { fromContractAddress, toContractAddress } = getContractAddresses(
      request
    )

    const [fromTokenId, toTokenId, fromAddress, toAddress] = await Promise.all([
      resolveTokenId(fromMainnet, fromContractAddress),
      resolveTokenId(toMainnet, toContractAddress),
      getAddress(fromWallet, addressTypeMap[fromWallet.currencyInfo.pluginId]),
      getAddress(toWallet, addressTypeMap[toWallet.currencyInfo.pluginId])
    ])

    if (fromTokenId == null || toTokenId == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromExchangeAmount = nativeToDenomination(
      fromWallet,
      nativeAmount,
      request.fromTokenId
    )

    // Fetch quotes and keep the best private route (highest output).
    const quoteResponse = await fetchCors(
      uri +
        `quotes?amount=${fromExchangeAmount}&from=${fromTokenId}&to=${toTokenId}`,
      { headers, corsBypass }
    )
    if (!quoteResponse.ok) {
      const text = await quoteResponse.text()
      throw new Error(
        `Houdini quotes returned ${quoteResponse.status}: ${text}`
      )
    }
    const { quotes } = asHoudiniQuotesResponse(await quoteResponse.json())

    // Limits are reported in the `from` token's display units.
    const isWithinLimits = (
      candidate: ReturnType<typeof asHoudiniQuote>
    ): boolean =>
      (candidate.min == null ||
        !lt(fromExchangeAmount, floatToDecimalString(candidate.min))) &&
      (candidate.max == null ||
        !gt(fromExchangeAmount, floatToDecimalString(candidate.max)))

    const privateQuotes = quotes
      .filter(
        (quote): quote is ReturnType<typeof asHoudiniQuote> =>
          quote != null && quote.type === 'private'
      )
      // Rank by output, highest first. Compare by sign rather than float
      // subtraction, which can lose the sign for close or very large values.
      .sort((a, b) =>
        a.amountOut === b.amountOut ? 0 : a.amountOut < b.amountOut ? 1 : -1
      )

    if (privateQuotes.length === 0) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Pick the highest-output route that actually accepts this amount, rather
    // than rejecting the swap when only the top route is out of range.
    const quote = privateQuotes.find(isWithinLimits)
    if (quote == null) {
      // No private route accepts the amount. Surface the most permissive limit.
      const mins = privateQuotes
        .map(candidate => candidate.min)
        .filter((min): min is number => min != null)
      const maxes = privateQuotes
        .map(candidate => candidate.max)
        .filter((max): max is number => max != null)
      const smallestMin = mins.length > 0 ? Math.min(...mins) : undefined
      const largestMax = maxes.length > 0 ? Math.max(...maxes) : undefined
      if (
        smallestMin != null &&
        lt(fromExchangeAmount, floatToDecimalString(smallestMin))
      ) {
        throw new SwapBelowLimitError(
          swapInfo,
          floatToNativeAmount(fromWallet, smallestMin, request.fromTokenId)
        )
      }
      if (
        largestMax != null &&
        gt(fromExchangeAmount, floatToDecimalString(largestMax))
      ) {
        throw new SwapAboveLimitError(
          swapInfo,
          floatToNativeAmount(fromWallet, largestMax, request.fromTokenId)
        )
      }
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Create the exchange. Assets and amounts ride on the quote; only the
    // destination (and optional refund) addresses go on the order.
    const orderBody = {
      addressTo: toAddress,
      quoteId: quote.quoteId,
      refundAddress: fromAddress
    }
    const orderResponse = await fetchCors(uri + 'exchanges', {
      method: 'POST',
      headers,
      body: JSON.stringify(orderBody),
      corsBypass
    })
    if (!orderResponse.ok) {
      const text = await orderResponse.text()
      throw new Error(
        `Houdini exchange returned ${orderResponse.status}: ${text}`
      )
    }
    const order = asHoudiniOrder(await orderResponse.json())

    const fromNativeAmount = floatToNativeAmount(
      fromWallet,
      order.inAmount,
      request.fromTokenId
    )
    const toNativeAmount = floatToNativeAmount(
      toWallet,
      order.outAmount,
      request.toTokenId
    )

    const memos: EdgeMemo[] =
      order.depositTag == null
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: order.depositTag
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: order.depositAddress
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
        orderId: order.houdiniId,
        orderUri: orderUri + order.houdiniId,
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
        payoutAddress: toAddress,
        payoutWalletId: toWallet.id,
        refundAddress: fromAddress
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: ensureInFuture(order.expires)
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

      const swapOrder = await fetchSwapQuoteInner(request)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}
