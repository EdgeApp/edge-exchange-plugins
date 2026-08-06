import { ceil, floor, gt, lt } from 'biggystring'
import {
  asArray,
  asBoolean,
  asDate,
  asEither,
  asObject,
  asOptional,
  asString,
  asValue
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
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { template as templateMapping } from '../../mappings/template'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkInvalidTokenIds,
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  ensureInFuture,
  getContractAddresses,
  getMaxSwappable,
  makeSwapPluginQuote,
  mapToRecord,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin } from '../types'
import { asOptionalBlank } from './changenow'

const pluginId = 'template'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'TemplateSwap',
  supportEmail: 'support@example.com'
}

const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString)
})

/**
 * Build the user-facing order URI from OUR OWN constant plus the order id.
 *
 * Never persist a partner-supplied URL (a `statusUrl` field or similar) into
 * `savedAction.orderUri`. That value is rendered as a tappable link in the
 * transaction details, so taking the host and scheme from an API response lets a
 * compromised or misbehaving provider steer users anywhere.
 */
const orderUri = 'https://example.com/?orderId='
// TODO: Replace with actual API base URL
const apiBaseUrl = 'https://api.example.com/api/v1/'

const asTemplateLimitError = asObject({
  code: asValue('BELOW_LIMIT', 'ABOVE_LIMIT'),
  message: asString,
  sourceLimitAmount: asNumberString,
  destinationLimitAmount: asNumberString
})

const asTemplateRegionError = asObject({
  code: asValue('REGION_UNSUPPORTED'),
  message: asString
})

const asTemplateCurrencyError = asObject({
  code: asValue('CURRENCY_UNSUPPORTED'),
  message: asString
})

const asTemplateError = asObject({
  errors: asArray(
    asEither(
      asTemplateLimitError,
      asTemplateRegionError,
      asTemplateCurrencyError
    )
  )
})

/**
 * Response of the QUOTE step, which prices the swap and nothing else.
 *
 * Note what is NOT here: no `orderId`, no `depositAddress`. Those belong to the
 * order step below. Keeping them apart is what lets the max probe run the quote
 * without creating anything, so the split is a requirement rather than a
 * stylistic preference. A `getQuote` that hands back a deposit address HAS
 * created an order, whatever it is named.
 */
const asTemplateQuote = asObject({
  quoteId: asString,
  sourceAmount: asNumberString,
  destinationAmount: asNumberString,

  /** API should return an ISO 8601 formatted date */
  expirationIsoDate: asDate,

  /**
   * Whether the provider GUARANTEES this rate, rather than quoting a floating
   * one. Drives `isEstimate`; see `fetchSwapQuoteInner`.
   */
  isFixedRate: asOptional(asBoolean, false),

  /**
   * Limits published alongside a SUCCESSFUL quote, in the same denominated units
   * as the amounts above. Providers that only report limits as errors leave
   * these absent; see the error branch in `fetchQuote`.
   *
   * A provider may return `null` for "no limit on this side". `asOptional` in
   * this version of `cleaners` treats JSON `null` as absent, so it covers both
   * a missing key and an explicit null.
   */
  sourceAmountMin: asOptional(asNumberString),
  sourceAmountMax: asOptional(asNumberString),
  destinationAmountMin: asOptional(asNumberString),
  destinationAmountMax: asOptional(asNumberString)
})

const asTemplateQuoteReply = asEither(asTemplateQuote, asTemplateError)

/**
 * Response of the ORDER step: the provider has now committed, and this is the
 * only call that does. `fetchSwapQuoteInner` makes it exactly once per swap.
 */
const asTemplateOrder = asObject({
  orderId: asString,
  depositAddress: asString,

  /**
   * Deposit tag/memo for memo-based chains (XRP destination tags, XLM memos).
   *
   * `asOptionalBlank(asNumberString)` rather than `asOptional(asString)`. Both of
   * the narrower cleaner's failure modes silently drop the memo and send an
   * UNTAGGED deposit, which is a lost-funds path on those chains:
   * - a NUMERIC memo (the common shape for an XRP destination tag, including the
   *   valid tag `0`) fails a string-only cleaner
   * - an EMPTY STRING becomes an empty `EdgeMemo` rather than no memo at all
   */
  depositExtraId: asOptionalBlank(asNumberString),

  /** The amount the provider expects to receive, echoed back. */
  sourceAmount: asNumberString,
  destinationAmount: asNumberString
})

interface TemplateCommonQuoteParams {
  fromNetwork: string
  toNetwork: string
  fromContractAddress?: string
  toContractAddress?: string
  fromEvmChainId?: number
  toEvmChainId?: number
  refundAddress: string
  destinationAddress: string
}

type TemplateFromQuoteParams = TemplateCommonQuoteParams & {
  sourceAmount: string
}

type TemplateToQuoteParams = TemplateCommonQuoteParams & {
  destinationAmount: string
}

type TemplateQuoteParams = TemplateFromQuoteParams | TemplateToQuoteParams

const EVM_CHAIN_NETWORK = 'evmChain'

const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  templateMapping
)

/**
 * Get the network identifier for a wallet. If the wallet is an EVM chain,
 * returns 'evmChain'. Otherwise, uses the mainnet code transcription.
 */
const getNetwork = (wallet: EdgeCurrencyWallet): string | null => {
  const evmChainId = wallet.currencyInfo.evmChainId
  if (evmChainId != null) return EVM_CHAIN_NETWORK
  return MAINNET_CODE_TRANSCRIPTION[
    wallet.currencyInfo.pluginId as EdgeCurrencyPluginId
  ]
}

/**
 * Convert a provider's decimal amount into WHOLE native (atomic) units.
 *
 * `denominationToNative` is a plain multiply, so a provider amount carrying more
 * decimals than the asset's denomination yields a FRACTIONAL native string
 * (`mul('0.123456789', '100000000')` is `12345678.9`). Edge native amounts are
 * integers everywhere, so a fraction reaching `spendTargets` or the swap
 * metadata is invalid.
 *
 * The rounding DIRECTION is not cosmetic:
 * - `'up'` for a floor (a minimum limit), so the enforced minimum never rounds
 *   BELOW the provider's real floor and the deposit gets rejected
 * - `'down'` for a ceiling and for a receive amount, so neither is ever larger
 *   than what the provider will actually honor
 */
const toNativeAmount = (
  wallet: EdgeCurrencyWallet,
  denominatedAmount: string,
  tokenId: EdgeTokenId,
  rounding: 'up' | 'down'
): string => {
  const native = denominationToNative(wallet, denominatedAmount, tokenId)
  return rounding === 'up' ? ceil(native, 0) : floor(native, 0)
}

export function makeTemplatePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const initOptions = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${initOptions.apiKey}`,
    Accept: 'application/json'
  }

  /**
   * Quote step. Resolves the pair, fetches a quote, maps provider errors, and
   * enforces limits.
   *
   * This step creates NO order, which is what makes it safe to run as the
   * `getMaxSwappable` probe (see `fetchProbeOrder`). If the provider exposes
   * quoting and order creation behind a SINGLE endpoint, keep that call OUT of
   * the probe path anyway: a probe that creates an order leaves an abandoned
   * live order at the provider on every max-swap request, and providers that
   * rate-limit order creation will then reject the real one.
   *
   * `enforceMax` is false ONLY for the probe. A max-swap probe deliberately
   * quotes the full PRE-FEE balance to discover the ceiling, so an above-limit
   * balance must clamp through `getMaxSpendable` rather than throw
   * `SwapAboveLimitError` and abort a max swap that would have succeeded once
   * network fees were subtracted.
   */
  const fetchQuote = async (
    request: EdgeSwapRequestPlugin,
    enforceMax: boolean
  ): Promise<{
    quote: ReturnType<typeof asTemplateQuote>
    fromAddress: string
    toAddress: string
  }> => {
    const { fromWallet, toWallet, quoteFor } = request

    const fromNetwork = getNetwork(fromWallet)
    const toNetwork = getNetwork(toWallet)

    if (fromNetwork == null || toNetwork == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromEvmChainId = fromWallet.currencyInfo.evmChainId
    const toEvmChainId = toWallet.currencyInfo.evmChainId

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet),
      getAddress(toWallet)
    ])

    // Convert the native amount to a denomination. A 'max' request never arrives
    // here as 'max': `getMaxSwappable` has already rewritten it into a 'from'
    // quote for the spendable balance, so only the two real directions exist.
    const isReverseQuote = quoteFor === 'to'
    const amount = isReverseQuote
      ? {
          destinationAmount: nativeToDenomination(
            toWallet,
            request.nativeAmount,
            request.toTokenId
          )
        }
      : {
          sourceAmount: nativeToDenomination(
            fromWallet,
            request.nativeAmount,
            request.fromTokenId
          )
        }

    const { fromContractAddress, toContractAddress } = getContractAddresses(
      request
    )

    const quoteParams: TemplateQuoteParams = {
      fromNetwork,
      toNetwork,
      fromContractAddress,
      toContractAddress,
      fromEvmChainId,
      toEvmChainId,
      refundAddress: fromAddress,
      destinationAddress: toAddress,
      ...amount
    }
    log('quoteParams:', quoteParams)

    const response = await io.fetch(apiBaseUrl + 'getQuote', {
      headers,
      method: 'POST',
      body: JSON.stringify(quoteParams)
    })
    if (!response.ok) {
      const text = await response.text()
      log.warn('Template API error response:', text)
      throw new Error(`Template returned error code ${response.status}`)
    }
    const responseJson = await response.json()

    let quoteReply
    try {
      quoteReply = asTemplateQuoteReply(responseJson)
    } catch (error: unknown) {
      log.warn(
        'Unexpected Template API response:',
        JSON.stringify(responseJson)
      )
      throw error
    }

    // The side the user pinned is the side every limit is expressed and thrown
    // on, so resolve it once.
    const limitSide = isReverseQuote ? 'to' : 'from'
    const limitWallet = isReverseQuote ? toWallet : fromWallet
    const limitTokenId = isReverseQuote
      ? request.toTokenId
      : request.fromTokenId

    if ('errors' in quoteReply) {
      // Throw errors in order of highest priority:
      // 1. Region unsupported
      // 2. Currency unsupported
      // 3. Below/Above limit
      //
      // If the provider reports failures as FREE TEXT rather than codes, rank
      // the limit keywords BEFORE the currency keywords, so a limit failure that
      // also names a token, path or route still surfaces as the limit error
      // instead of a weaker `SwapCurrencyError`. Match whole phrases, not bare
      // substrings: a substring test for 'LOW' also matches 'ALLOWANCE'.
      const errors = quoteReply.errors
      if (errors.find(error => error.code === 'REGION_UNSUPPORTED') != null) {
        throw new SwapPermissionError(swapInfo, 'geoRestriction')
      }
      if (errors.find(error => error.code === 'CURRENCY_UNSUPPORTED') != null) {
        throw new SwapCurrencyError(swapInfo, request)
      }
      const limitError = errors.find(
        error => error.code === 'BELOW_LIMIT' || error.code === 'ABOVE_LIMIT'
      )
      if (limitError != null && 'sourceLimitAmount' in limitError) {
        const isBelow = limitError.code === 'BELOW_LIMIT'
        // Pick the limit field by which SIDE the user pinned, never by whether
        // the error is a floor or a ceiling. `limitWallet` and `limitTokenId`
        // are the pinned side's, so pairing them with the other side's amount
        // converts through the wrong denomination and reports a limit that is
        // wrong by the ratio between the two assets.
        const nativeMinMaxAmount = toNativeAmount(
          limitWallet,
          isReverseQuote
            ? limitError.destinationLimitAmount
            : limitError.sourceLimitAmount,
          limitTokenId,
          // A minimum rounds UP and a maximum rounds DOWN, so neither rounding
          // widens the range the provider actually accepts.
          isBelow ? 'up' : 'down'
        )
        // NOTE: a provider that reports limits ONLY as errors cannot have its
        // above-limit case clamped by the max probe, because there is no quote
        // to size against. Such a provider should be pre-checked against a
        // limits endpoint before quoting, if it exposes one.
        throw isBelow
          ? new SwapBelowLimitError(swapInfo, nativeMinMaxAmount, limitSide)
          : new SwapAboveLimitError(swapInfo, nativeMinMaxAmount, limitSide)
      }
      throw new Error(
        `Unknown error type: ${JSON.stringify(quoteReply.errors)}`
      )
    }

    // Enforce limits published ALONGSIDE a successful quote against the USER'S
    // REQUESTED amount, never against the amount echoed back in the quote. A
    // provider that silently CLAMPS an out-of-range request to its own ceiling
    // returns a perfectly in-range echo, so comparing the echo lets the swap
    // proceed for less than the user asked, with the difference refunded at
    // whatever rate the provider picks.
    const rawMin = isReverseQuote
      ? quoteReply.destinationAmountMin
      : quoteReply.sourceAmountMin
    const rawMax = isReverseQuote
      ? quoteReply.destinationAmountMax
      : quoteReply.sourceAmountMax

    if (rawMin != null) {
      const nativeMin = toNativeAmount(limitWallet, rawMin, limitTokenId, 'up')
      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin, limitSide)
      }
    }
    if (enforceMax && rawMax != null) {
      const nativeMax = toNativeAmount(
        limitWallet,
        rawMax,
        limitTokenId,
        'down'
      )
      if (gt(request.nativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(swapInfo, nativeMax, limitSide)
      }
    }

    return { quote: quoteReply, fromAddress, toAddress }
  }

  /**
   * `getMaxSwappable` probe: build a `SwapOrder` from a quote ALONE, so
   * `getMaxSpendable` can price the network fee before any real order — and its
   * payin address — exists. The trimmed amount it computes is then run through
   * the real `fetchSwapQuoteInner`, which creates exactly one order.
   */
  const fetchProbeOrder = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { quote, fromAddress } = await fetchQuote(request, false)
    const fromNativeAmount = toNativeAmount(
      request.fromWallet,
      quote.sourceAmount,
      request.fromTokenId,
      'down'
    )
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          // The user's own from-chain address stands in for the payin address
          // that does not exist yet. It is on the correct chain, so fee
          // estimation sees the same shape the real spend will have.
          publicAddress: fromAddress
        }
      ],
      networkFeeOption: 'high',
      // This spend is NEVER broadcast. Its target is the user's own address,
      // which engines that compare the target against their own public key
      // reject with `SpendToSelfError` — every EVM chain, where the public key
      // IS the address. Without this flag that error escapes `getMaxSwappable`
      // and fails every max swap from an EVM wallet. The real order keeps all
      // checks.
      skipChecks: true,
      assetAction: {
        assetActionType: 'swap'
      }
    }
    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: ensureInFuture(quote.expirationIsoDate)
    }
  }

  /**
   * The ONLY call that creates an order. Runs once per swap, after
   * `getMaxSwappable` has already settled on the final amount.
   */
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet } = request
    const { quote, fromAddress, toAddress } = await fetchQuote(request, true)

    // Create the order from the quote the provider already holds, so the priced
    // amount cannot drift between the two calls.
    const orderResponse = await io.fetch(apiBaseUrl + 'createOrder', {
      headers,
      method: 'POST',
      body: JSON.stringify({
        quoteId: quote.quoteId,
        refundAddress: fromAddress,
        destinationAddress: toAddress
      })
    })
    if (!orderResponse.ok) {
      const text = await orderResponse.text()
      log.warn('Template API error response:', text)
      throw new Error(`Template returned error code ${orderResponse.status}`)
    }
    const orderJson = await orderResponse.json()

    let order
    try {
      order = asTemplateOrder(orderJson)
    } catch (error: unknown) {
      log.warn('Unexpected Template API response:', JSON.stringify(orderJson))
      throw error
    }

    const fromNativeAmount = toNativeAmount(
      fromWallet,
      order.sourceAmount,
      request.fromTokenId,
      'down'
    )
    // The receive amount rounds DOWN, so the figure shown to the user is never
    // larger than what the provider actually sends.
    const payoutNativeAmount = toNativeAmount(
      toWallet,
      order.destinationAmount,
      request.toTokenId,
      'down'
    )

    // TRUST BOUNDARY. `fromNativeAmount` comes from the provider's response and
    // is about to become a SIGNED SPEND, so bound it by what the user actually
    // requested. Without this, a compromised or malformed response can move more
    // of the source asset than the quote asked for.
    //
    // Bound every field the spend path CONSUMES, not just the one field that is
    // easiest to reach — on a DeFi route that includes any token-approval amount
    // and any native value attached to the transaction. Compare each against a
    // value in ITS OWN units: a native fee in wei must not be compared against a
    // token amount in token base units, or legitimate quotes get rejected.
    //
    // Only a 'from' quote pins the source amount locally. On a reverse ('to')
    // quote the user pinned the RECEIVE amount, so the source side is the
    // provider's to determine and there is nothing local to bound it against.
    if (
      request.quoteFor === 'from' &&
      gt(fromNativeAmount, request.nativeAmount)
    ) {
      throw new Error(
        'Template returned a source amount above the requested amount'
      )
    }

    const memos: EdgeMemo[] =
      order.depositExtraId == null
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: order.depositExtraId
            }
          ]

    // Make the transaction:
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
        orderId: order.orderId,
        orderUri: orderUri + order.orderId,
        // Report what the provider ACTUALLY guarantees. Hardcoding `false` shows
        // the user a locked receive amount on a floating route, so a
        // market-moving leg silently delivers less than the quote promised.
        isEstimate: !quote.isFixedRate,
        toAsset: {
          pluginId: toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: payoutNativeAmount
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

    log('spendInfo', spendInfo)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: ensureInFuture(quote.expirationIsoDate)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      // Reject blocked assets and same-asset (self) swaps CLIENT-SIDE, before
      // any provider endpoint is hit. This shared helper also carries the
      // repo-wide `defaultInvalidCodes` list, so skipping it opts out of every
      // future entry added there as well.
      //
      // If a provider's main flow is legitimately same-asset (a mixer, a private
      // send), extend the helper rather than dropping the call, so the blocked
      // list still applies.
      checkInvalidTokenIds({ from: {}, to: {} }, request, swapInfo)

      // A 'max' request arrives carrying the wallet's RAW balance.
      // `getMaxSwappable` probes with `fetchProbeOrder` to price network fees,
      // rewrites the request as a 'from' quote for the spendable remainder, and
      // only then does the real quote below create an order.
      const newRequest = await getMaxSwappable(fetchProbeOrder, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
