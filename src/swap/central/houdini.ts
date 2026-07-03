import { gt, lt, round } from 'biggystring'
import {
  asArray,
  asDate,
  asEither,
  asJSON,
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
  getMaxSwappable,
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
 * A swap-to-address destination arrives as a core-built synthetic wallet whose
 * id carries this prefix. Synthetic wallets hold exactly one pasted address
 * (already validated by the caller), so typed-address lookups do not apply,
 * and they may expose destination memos through a `getMemos` method.
 */
const SYNTHETIC_WALLET_ID_PREFIX = 'synthetic://'

interface SyntheticDestinationMethods {
  getMemos?: () => Promise<EdgeMemo[]>
}

/**
 * Reads the destination memos (e.g. an XRP destination tag) off a core-built
 * synthetic destination wallet. Real wallets have no `getMemos`; their payout
 * goes to the user's own address, which needs no tag.
 */
async function getDestinationMemos(
  toWallet: EdgeCurrencyWallet
): Promise<EdgeMemo[]> {
  const { getMemos } = toWallet as EdgeCurrencyWallet &
    SyntheticDestinationMethods
  if (getMemos == null) return []
  return await getMemos()
}

/**
 * Edge `EdgeCurrencyPluginId` -> Houdini chain `shortName`. Chains that Houdini
 * cannot serve map to `null` and are rejected up front by
 * `checkWhitelistedMainnetCodes`.
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
  minOut: asOptional(asNumber),
  maxOut: asOptional(asNumber),
  validUntil: asOptional(asString)
})

type HoudiniQuote = ReturnType<typeof asHoudiniQuote>

const asHoudiniQuotesResponse = asObject({
  quotes: asArray(asMaybe(asHoudiniQuote))
})

/** The API's error envelope; `message` is human-readable. */
const asHoudiniApiError = asMaybe(
  asJSON(asObject({ message: asString }).withRest)
)

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

    // A `max` request is resolved to a balance-sized `from` request by
    // `getMaxSwappable` before it reaches this function.
    const reverseQuote = quoteFor === 'to'

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

    // A synthetic (swap-to-address) destination holds exactly one pasted,
    // caller-validated address, so a typed-address lookup does not apply.
    const isSyntheticDestination = toWallet.id.startsWith(
      SYNTHETIC_WALLET_ID_PREFIX
    )
    const toAddressType = isSyntheticDestination
      ? undefined
      : addressTypeMap[toWallet.currencyInfo.pluginId]

    const [
      fromTokenId,
      toTokenId,
      fromAddress,
      toAddress,
      toMemos
    ] = await Promise.all([
      resolveTokenId(fromMainnet, fromContractAddress),
      resolveTokenId(toMainnet, toContractAddress),
      getAddress(fromWallet, addressTypeMap[fromWallet.currencyInfo.pluginId]),
      getAddress(toWallet, toAddressType),
      getDestinationMemos(toWallet)
    ])

    if (fromTokenId == null || toTokenId == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // The quote amount is in the display units of whichever side the caller
    // fixed: the `from` amount normally, or the `to` (receive) amount for a
    // reverse quote, which Houdini prices via `amountType=receive`.
    const exchangeAmount = reverseQuote
      ? nativeToDenomination(toWallet, nativeAmount, request.toTokenId)
      : nativeToDenomination(fromWallet, nativeAmount, request.fromTokenId)

    // Fetch quotes and keep the best private route. Pricing by the receive
    // amount (`amountType=receive`) is only offered on fixed-rate quotes.
    const quoteResponse = await fetchCors(
      uri +
        `quotes?amount=${exchangeAmount}&from=${fromTokenId}&to=${toTokenId}` +
        (reverseQuote ? '&amountType=receive&fixed=true' : ''),
      { headers, corsBypass }
    )
    if (!quoteResponse.ok) {
      const text = await quoteResponse.text()
      // Surface the API's own human-readable message when it carries one
      // (e.g. "Amount is too low, minimum is 25 USD") instead of raw JSON:
      const apiError = asHoudiniApiError(text)
      throw new Error(
        apiError != null
          ? `HoudiniSwap: ${apiError.message}`
          : `Houdini quotes returned ${quoteResponse.status}: ${text}`
      )
    }
    const { quotes } = asHoudiniQuotesResponse(await quoteResponse.json())

    // Forward limits (`min`/`max`) are in the `from` token's display units;
    // reverse limits (`minOut`/`maxOut`) are in the `to` token's. A reverse
    // quote must also clear the route's from-side bounds with its own priced
    // send amount (`amountIn`), which the API enforces at order creation.
    const isWithinLimits = (candidate: HoudiniQuote): boolean => {
      if (reverseQuote) {
        const amountIn =
          candidate.amountIn == null
            ? undefined
            : floatToDecimalString(candidate.amountIn)
        return (
          (candidate.minOut == null ||
            !lt(exchangeAmount, floatToDecimalString(candidate.minOut))) &&
          (candidate.maxOut == null ||
            !gt(exchangeAmount, floatToDecimalString(candidate.maxOut))) &&
          (amountIn == null ||
            candidate.min == null ||
            !lt(amountIn, floatToDecimalString(candidate.min))) &&
          (amountIn == null ||
            candidate.max == null ||
            !gt(amountIn, floatToDecimalString(candidate.max)))
        )
      }
      return (
        (candidate.min == null ||
          !lt(exchangeAmount, floatToDecimalString(candidate.min))) &&
        (candidate.max == null ||
          !gt(exchangeAmount, floatToDecimalString(candidate.max)))
      )
    }

    // Forward quotes take private (multi-exchange) routes only. Houdini's
    // exact-out pricing is offered solely on fixed-rate quotes, which its
    // private routing does not serve today, so reverse quotes also accept
    // standard routes: those still settle through Houdini (the recipient
    // never sees the sender's address) but use a single exchange leg. Private
    // routes stay preferred whenever the API offers them.
    const candidateQuotes = quotes
      .filter(
        (quote): quote is HoudiniQuote =>
          quote != null &&
          (quote.type === 'private' ||
            (reverseQuote && quote.type === 'standard'))
      )
      // Rank private routes first, then by best rate: highest output for a
      // fixed input, or lowest input for a fixed output. Compare by sign
      // rather than float subtraction, which can lose the sign for close or
      // very large values.
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'private' ? -1 : 1
        if (reverseQuote) {
          const aIn = a.amountIn ?? Infinity
          const bIn = b.amountIn ?? Infinity
          return aIn === bIn ? 0 : aIn > bIn ? 1 : -1
        }
        return a.amountOut === b.amountOut
          ? 0
          : a.amountOut < b.amountOut
          ? 1
          : -1
      })

    if (candidateQuotes.length === 0) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Keep the routes that actually accept this amount, rather than
    // rejecting the swap when only the top route is out of range.
    const inRangeQuotes = candidateQuotes.filter(isWithinLimits)
    if (inRangeQuotes.length === 0) {
      // No route accepts the amount. Surface the most permissive limit, in
      // the units (and direction) of the side the caller fixed.
      const mins = candidateQuotes
        .map(candidate => (reverseQuote ? candidate.minOut : candidate.min))
        .filter((min): min is number => min != null)
      const maxes = candidateQuotes
        .map(candidate => (reverseQuote ? candidate.maxOut : candidate.max))
        .filter((max): max is number => max != null)
      const smallestMin = mins.length > 0 ? Math.min(...mins) : undefined
      const largestMax = maxes.length > 0 ? Math.max(...maxes) : undefined
      const limitWallet = reverseQuote ? toWallet : fromWallet
      const limitTokenId = reverseQuote
        ? request.toTokenId
        : request.fromTokenId
      const limitDirection = reverseQuote ? 'to' : 'from'
      if (
        smallestMin != null &&
        lt(exchangeAmount, floatToDecimalString(smallestMin))
      ) {
        throw new SwapBelowLimitError(
          swapInfo,
          floatToNativeAmount(limitWallet, smallestMin, limitTokenId),
          limitDirection
        )
      }
      if (
        largestMax != null &&
        gt(exchangeAmount, floatToDecimalString(largestMax))
      ) {
        throw new SwapAboveLimitError(
          swapInfo,
          floatToNativeAmount(limitWallet, largestMax, limitTokenId),
          limitDirection
        )
      }

      // A reverse quote can also fail the route's from-side bounds with its
      // priced send amount. Report those in from units.
      if (reverseQuote) {
        const best = candidateQuotes[0]
        const bestIn =
          best.amountIn == null
            ? undefined
            : floatToDecimalString(best.amountIn)
        if (
          bestIn != null &&
          best.min != null &&
          lt(bestIn, floatToDecimalString(best.min))
        ) {
          throw new SwapBelowLimitError(
            swapInfo,
            floatToNativeAmount(fromWallet, best.min, request.fromTokenId),
            'from'
          )
        }
        if (
          bestIn != null &&
          best.max != null &&
          gt(bestIn, floatToDecimalString(best.max))
        ) {
          throw new SwapAboveLimitError(
            swapInfo,
            floatToNativeAmount(fromWallet, best.max, request.fromTokenId),
            'from'
          )
        }
      }
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Create the exchange. Assets and amounts ride on the quote; only the
    // destination (and optional refund) addresses go on the order, plus the
    // destination memo (e.g. an XRP destination tag) when one was provided.
    // A fixed-rate route's static deposit address can be held by another live
    // order (HTTP 409 STATIC_DEPOSIT_IN_USE); fall through to the next-best
    // in-range route when that happens.
    const destinationTag = toMemos.length > 0 ? toMemos[0].value : undefined
    let order: ReturnType<typeof asHoudiniOrder> | undefined
    let lastError = ''
    for (const candidate of inRangeQuotes.slice(0, 3)) {
      const orderBody = {
        addressTo: toAddress,
        quoteId: candidate.quoteId,
        refundAddress: fromAddress,
        ...(destinationTag == null ? {} : { destinationTag })
      }
      const orderResponse = await fetchCors(uri + 'exchanges', {
        method: 'POST',
        headers,
        body: JSON.stringify(orderBody),
        corsBypass
      })
      if (orderResponse.ok) {
        order = asHoudiniOrder(await orderResponse.json())
        break
      }
      const text = await orderResponse.text()
      const apiError = asHoudiniApiError(text)
      lastError =
        apiError != null
          ? `HoudiniSwap: ${apiError.message}`
          : `Houdini exchange returned ${orderResponse.status}: ${text}`
      if (
        orderResponse.status !== 409 ||
        !text.includes('STATIC_DEPOSIT_IN_USE')
      ) {
        throw new Error(lastError)
      }
    }
    if (order == null) {
      throw new Error(lastError)
    }

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

      const newRequest = await getMaxSwappable(fetchSwapQuoteInner, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}
