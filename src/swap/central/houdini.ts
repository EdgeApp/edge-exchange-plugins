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
  asString,
  asValue
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeFetchResponse,
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
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getContractAddresses,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToRecord,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  getAddress,
  memoType,
  nativeToDenomination,
  snooze
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

/**
 * Assets this plugin refuses outright. Empty: the provider's own token list is
 * the authority on what it serves, and anything absent from it already fails
 * the token-id lookup. The shared blocked-token defaults still apply.
 */
const INVALID_TOKEN_IDS: InvalidTokenIds = { from: {}, to: {} }

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

/**
 * The 429 envelope, per Houdini's rate-limits-and-tiers doc. `retryAfter` is
 * in seconds and names the earliest moment the window reopens.
 */
const asHoudiniRateLimitError = asMaybe(
  asJSON(
    asObject({
      type: asValue('RATE_LIMIT_EXCEEDED'),
      retryAfter: asOptional(asNumber),
      limit: asOptional(asNumber),
      windowMs: asOptional(asNumber)
    }).withRest
  )
)

// Backoff for a rate-limited call. Houdini is an aggregator whose per-pair
// availability fluctuates, so a 429 must never be mistaken for a missing
// route: the call is retried behind `retryAfter` and, once the retries are
// spent, fails with a message that says rate limit rather than unavailable.
const RATE_LIMIT_MAX_RETRIES = 3
const RATE_LIMIT_MIN_DELAY_MS = 1000
const RATE_LIMIT_MAX_DELAY_MS = 30000

/**
 * How long to wait before retrying a 429, given the attempt number and the
 * `retryAfter` seconds the API reported (if any).
 *
 * `RATE_LIMIT_MAX_DELAY_MS` bounds OUR OWN doubling; it is not a ceiling on
 * the window the provider asked for. Houdini's 1-per-minute exchange budget
 * reports `retryAfter` near 60, so capping that at 30s retried while still
 * inside the window, drew another 429, and spent the retries for nothing.
 */
export function rateLimitDelayMs(
  attempt: number,
  retryAfterSec: number | undefined
): number {
  // `retryAfter` is the floor the API asked for; the doubling on top of it
  // keeps a burst from re-colliding at the moment the window reopens.
  const apiFloorMs = retryAfterSec == null ? 0 : retryAfterSec * 1000
  const baseMs = Math.max(apiFloorMs, RATE_LIMIT_MIN_DELAY_MS)
  const backoffMs = Math.min(baseMs * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS)
  return Math.max(backoffMs, apiFloorMs)
}

const asHoudiniOrder = asObject({
  houdiniId: asString,
  depositAddress: asString,
  depositTag: asOptional(asString),
  expires: asOptional(asDate),
  inAmount: asNumber,
  outAmount: asNumber
})

/**
 * Whether a token entry is the chain's own coin rather than a contract token.
 * Houdini spells "no contract" as either `null` or an empty string.
 */
function isNativeToken(token: { address: string | null }): boolean {
  return token.address == null || token.address === ''
}

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

  /**
   * Every call to the partner API. Retries a rate-limited call behind the
   * window the API reports, and turns an exhausted retry budget into an error
   * that names the rate limit. Any other status is handed back untouched for
   * the caller to interpret.
   */
  async function fetchHoudini(
    path: string,
    init: { method?: string; body?: string } = {}
  ): Promise<EdgeFetchResponse> {
    for (let attempt = 0; ; ++attempt) {
      const response = await fetchCors(uri + path, {
        ...init,
        headers,
        corsBypass
      })
      if (response.status !== 429) return response

      const text = await response.text()
      const rateLimit = asHoudiniRateLimitError(text)
      if (attempt >= RATE_LIMIT_MAX_RETRIES) {
        throw new Error(
          'HoudiniSwap: rate limit exceeded, please try again shortly'
        )
      }

      const delayMs = rateLimitDelayMs(attempt, rateLimit?.retryAfter)
      log.warn(
        `Houdini rate limited (${
          rateLimit?.limit ?? '?'
        }/window), retrying in ${delayMs}ms`
      )
      await snooze(delayMs)
    }
  }

  /**
   * Memoized chain -> (addressKey -> tokenId) lookups, so repeat quotes on the
   * same assets do not re-hit `GET /tokens`.
   *
   * A cached `undefined` is a MISS the provider answered: it listed this chain's
   * tokens and none matched. That is a stable fact for the session, and caching
   * it is what keeps a chain the provider serves no native for from spending a
   * rate-limited call on every quote. This is the whole mechanism by which an
   * unserved chain declines cheaply, so the chain table never has to assert
   * which chains are served.
   *
   * Entries are the in-flight promises, so concurrent askers share one call.
   */
  const tokenIdCache = new Map<string, Promise<string | undefined>>()

  async function resolveTokenId(
    chain: string,
    contractAddress: string | undefined
  ): Promise<string | undefined> {
    const addressKey = contractAddress?.toLowerCase() ?? 'native'
    const cacheKey = `${chain}:${addressKey}`
    const cached = tokenIdCache.get(cacheKey)
    if (cached != null) return await cached

    // The IN-FLIGHT promise is what gets cached, not its result. A quote
    // resolves both legs with `Promise.all`, so a same-asset quote asks the
    // same question twice at once; caching only on completion lets both miss
    // and spend two calls on one answer.
    const lookup = fetchTokenId(chain, contractAddress, addressKey)
    tokenIdCache.set(cacheKey, lookup)
    // A rejected lookup must not stick, for the same reason a failure is not a
    // decline: the provider never answered.
    lookup.catch(() => tokenIdCache.delete(cacheKey))
    return await lookup
  }

  async function fetchTokenId(
    chain: string,
    contractAddress: string | undefined,
    addressKey: string
  ): Promise<string | undefined> {
    const query =
      contractAddress != null
        ? `tokens?chain=${chain}&address=${contractAddress}&pageSize=100`
        : `tokens?chain=${chain}&mainnet=true&pageSize=100`
    const response = await fetchHoudini(query)
    if (!response.ok) {
      // Nothing is cached, and nothing is RETURNED either. Returning a miss
      // here would be indistinguishable from the provider answering "no such
      // token", so a bad minute at the API would read to the user as a pair
      // Houdini cannot route. Throwing names the real cause, the same way the
      // quote path surfaces its own failures.
      const text = await response.text()
      log.warn('Houdini tokens lookup error:', text)
      throw new Error(`Houdini tokens returned ${response.status}: ${text}`)
    }
    const { tokens } = asHoudiniTokensResponse(await response.json())

    const match = tokens.find(token => {
      if (token == null || token.chain !== chain) return false
      // A chain's own coin carries no contract address, which the API spells
      // either as `null` or as an empty string depending on the chain. Testing
      // for `null` alone missed the empty-string chains (ALGO, XEC, HYPE, S,
      // XLM, ZEC), so none of them could resolve a token id at all.
      if (contractAddress == null) return isNativeToken(token)
      return token.address?.toLowerCase() === addressKey
    })

    return match?.id
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
    const quoteResponse = await fetchHoudini(
      `quotes?amount=${exchangeAmount}&from=${fromTokenId}&to=${toTokenId}` +
        (reverseQuote ? '&amountType=receive&fixed=true' : '')
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

    // A request that demands privacy takes `private` (multi-exchange) routes
    // only, since a `standard` route settles through a single exchange leg
    // that can relink the two sides. Everything else may also take standard
    // routes, which matters below Houdini's 25 USD private floor, where
    // standard is the only thing on offer down to 10 USD. Private stays
    // preferred wherever the API offers it.
    //
    // Houdini prices exact-out on fixed-rate quotes alone, which its private
    // routing does not serve, so a private request priced by the receive side
    // finds nothing and declines. That is the honest answer: the caller can
    // re-price by the send side and keep its privacy, which is what the send
    // scene's fixed-to fallback does.
    const privateOnly = request.privacy === 'required'
    const candidateQuotes = quotes
      .filter(
        (quote): quote is HoudiniQuote =>
          quote != null &&
          (quote.type === 'private' ||
            (!privateOnly && quote.type === 'standard'))
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
      const orderResponse = await fetchHoudini('exchanges', {
        method: 'POST',
        body: JSON.stringify(orderBody)
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
        // Only the exact-out path asks for `fixed=true`, and Houdini serves
        // fixed rates on that path alone: a forward quote floats, private or
        // standard. Reporting every quote as fixed showed users a locked
        // receive amount for a leg whose rate can still move.
        isEstimate: !reverseQuote,
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

      // Same-asset is allowed here where other plugins reject it: routing an
      // asset to itself through the mixer is this provider's main flow, not a
      // user mistake. The blocked-token checks still apply.
      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo, {
        allowSameAsset: true
      })
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
