import { ceil, floor, gt, lt } from 'biggystring'
import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'
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
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { CypherGoatAsset, cyphergoatAssets } from '../../mappings/cyphergoat'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkInvalidTokenIds,
  denominationToNative,
  ensureInFuture,
  getMaxSwappable,
  makeSwapPluginQuote,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin } from '../types'
import { asOptionalBlank } from './changenow'

const pluginId = 'cyphergoat'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'CypherGoat',
  supportEmail: 'support@cyphergoat.com'
}

const asInitOptions = asObject({
  apiKey: asString,
  /** CypherGoat affiliate code, credited on every order this plugin creates. */
  affiliateId: asOptional(asString)
})

const apiBaseUrl = 'https://api.cyphergoat.com'

/**
 * User-facing order page, built from OUR OWN constant plus the order id.
 *
 * The `/swap` response also carries a `Track` field holding the underlying
 * exchange's own tracking URL. It is deliberately not consumed: `orderUri`
 * renders as a tappable link in the transaction details, so taking its host and
 * scheme from an API response would let a compromised upstream steer users
 * anywhere.
 */
const orderUri = 'https://cyphergoat.com/transaction/'

/**
 * CypherGoat attaches no expiry to a quote or an order, so the plugin picks
 * one. Every CypherGoat route is a floating estimate re-priced continuously
 * across its underlying exchanges (see `isEstimate` below), so a short window
 * keeps the figure the user approves close to the one the quote was built from.
 */
const expirationMs = 1000 * 60

/**
 * Identifies this traffic to CypherGoat, which reports volume per source.
 */
const sourceTag = 'edge'

/**
 * A CypherGoat amount, as a plain decimal string.
 *
 * Every amount arrives as a JSON NUMBER, so `asNumberString`'s `toString()` can
 * hand back exponential notation for a small one (`1e-7`). `biggystring` reads
 * that as a plain string and misorders or mis-multiplies it, which the repo's
 * amount rules call out specifically, so the exponent is expanded here, once,
 * at the cleaner rather than at each use.
 *
 * The values this actually bites on are real: CypherGoat's published minimums
 * run down to `4.449e-05` for BTC, and a smaller one on an 18-decimal asset
 * would cross the `1e-7` threshold where V8 switches notation.
 */
const asDecimalString = (raw: unknown): string => {
  const value = asNumberString(raw)
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(value)
  if (match == null) return value

  const [, sign, whole, fraction = '', exponentText] = match
  const exponent = Number(exponentText)
  const digits = whole + fraction
  // Where the decimal point lands once the exponent is applied.
  const pointIndex = whole.length + exponent

  if (pointIndex <= 0) return `${sign}0.${'0'.repeat(-pointIndex)}${digits}`
  if (pointIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(pointIndex - digits.length)}`
  }
  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`
}

/**
 * A single exchange's quote inside the `rates.Results` array.
 *
 * CypherGoat is an aggregator, so a successful `/estimate` returns one entry per
 * underlying exchange it could price, and `/swap` then takes the chosen
 * exchange's name back as its `partner` parameter.
 *
 * The field names are capitalized because the API marshals its Go structs
 * without JSON tags; this is the shape a live response actually has.
 */
const asCypherGoatRate = asObject({
  Exchange: asString,
  Amount: asDecimalString,
  /** 0 = no KYC on this route, rising with how much the exchange may demand. */
  KYCScore: asOptional(asNumber, 0)
})

/**
 * Response of the ESTIMATE step, which prices the swap and commits to nothing.
 *
 * Note what is NOT here: no order id, no deposit address. `/estimate` creates
 * nothing at CypherGoat, which is what lets the max probe run it without
 * leaving an abandoned order behind.
 */
const asCypherGoatEstimate = asObject({
  rates: asObject({
    Results: asArray(asCypherGoatRate),
    /** Echoed back to `/swap` so CypherGoat can tie the order to its quote. */
    EstimateId: asOptional(asNumber)
  }),
  /**
   * Minimum send amount for the source coin, in DENOMINATED units. Present on
   * every successful estimate; `0` when CypherGoat publishes no floor.
   *
   * CypherGoat publishes no maximum, on this response or anywhere else, so no
   * `SwapAboveLimitError` is ever thrown. See the note in `fetchQuote`.
   */
  min: asOptional(asDecimalString, '0')
})

/**
 * Response of the SWAP step: the only call that commits, made once per swap.
 */
const asCypherGoatOrder = asObject({
  transaction: asObject({
    /** Deposit address the user sends the source asset to. */
    Address: asString,
    /** CypherGoat's own order id (a UUID), and the `/transaction` key. */
    CGID: asString,
    /** The chosen underlying exchange, echoed back. */
    Provider: asOptional(asString),
    /** What CypherGoat expects to receive, and to pay out, in denominated units. */
    SendAmount: asOptional(asDecimalString),
    EstimateAmount: asDecimalString,
    /**
     * Deposit tag/memo for memo-based chains (XRP destination tags, XLM memos).
     *
     * `asOptionalBlank(asNumberString)` rather than `asOptional(asString)`:
     * both of the narrower cleaner's failure modes silently drop the memo and
     * send an UNTAGGED deposit, which loses funds on those chains. A NUMERIC
     * memo (the usual shape of an XRP destination tag, including the valid tag
     * `0`) fails a string-only cleaner, and an EMPTY STRING becomes an empty
     * `EdgeMemo` rather than no memo at all.
     */
    Memo: asOptionalBlank(asNumberString)
  })
})

/**
 * Error body for every failing endpoint: `{"error": <string>}`.
 *
 * CypherGoat reports failures as free text rather than machine-readable codes,
 * so `classifyEstimateError` matches whole phrases against it. That is a gap in
 * the provider's API (`docs/API_REQUIREMENTS.md` section 3), not a shape worth
 * copying into a new integration.
 *
 * `/swap` is worse still: it serializes a Go `error` value directly, which
 * marshals to `{"error":{}}` and carries nothing at all. `asOptional(asString)`
 * leaves `error` undefined for that body rather than failing the cleaner.
 */
const asCypherGoatError = asObject({
  error: asOptional(asString)
})

/**
 * The minimum reported inside a below-minimum error, e.g.
 * `amount is less than the minimum value of 0.000044 for btc`.
 *
 * CypherGoat TRUNCATES the figure here: the same pair's successful estimate
 * reports `min: 0.00004449`, so this text understates the real floor. The
 * captured value is still the only limit available on this path, and it is
 * rounded up into native units at the call site, so an amount between the two
 * is accepted locally and then refused by CypherGoat. Fixing that needs the
 * provider to report the untruncated limit.
 */
const minimumRe = /minimum value of ([\d.]+)/

/**
 * Convert a provider decimal amount into WHOLE native (atomic) units.
 *
 * `denominationToNative` is a plain multiply, so a provider amount carrying
 * more decimals than the asset's denomination yields a FRACTIONAL native string
 * (`mul('0.123456789', '100000000')` is `12345678.9`). Edge native amounts are
 * integers everywhere.
 *
 * The rounding DIRECTION is not cosmetic: `'up'` for a minimum, so the enforced
 * floor never sits below the provider's real one, and `'down'` for a receive
 * amount, so the user is never shown more than what actually arrives.
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

/**
 * Resolve an Edge (wallet, tokenId) pair to the CypherGoat `coin`/`network`
 * pair naming the same asset, or null when CypherGoat does not list it.
 *
 * Keyed by tokenId rather than by currency code on purpose: a user-added custom
 * token whose currencyCode happens to be `USDT` must not resolve, or the plugin
 * would quote the real USDT and then have the user deposit the impostor.
 */
const getAsset = (
  wallet: EdgeCurrencyWallet,
  tokenId: EdgeTokenId
): CypherGoatAsset | null => {
  const pluginId = wallet.currencyInfo.pluginId as EdgeCurrencyPluginId
  return cyphergoatAssets.get(pluginId)?.get(tokenId) ?? null
}

export function makeCypherGoatPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { affiliateId, apiKey } = asInitOptions(opts.initOptions)
  const fetchCors = io.fetchCors ?? io.fetch

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`
  }

  /**
   * Map a failing `/estimate` body onto the right Edge error.
   *
   * Ranking matters and follows `docs/CREATING_AN_EXCHANGE_PLUGIN.md` step 6: a
   * limit failure is checked BEFORE the unsupported-pair fallback, because
   * edge-core-js ranks `SwapCurrencyError` below another plugin's limit error,
   * so misclassifying a below-minimum amount hides the figure the user needs
   * and surfaces the misleading "no enabled exchanges support this pair".
   *
   * Everything that is not a recognized limit failure becomes
   * `SwapCurrencyError`, which makes the GUI omit CypherGoat for this pair
   * rather than fail the whole swap screen. CypherGoat answers 404 both for a
   * pair it cannot name and for one it can name but could not price just now,
   * and both are the same steady state from Edge's side.
   */
  const classifyEstimateError = (
    request: EdgeSwapRequestPlugin,
    status: number,
    body: string
  ): never => {
    // A 5xx is an outage, not a statement about the pair. Surfacing it as
    // `SwapCurrencyError` would report a permanent "unsupported pair" for a
    // transient failure, and can poison pair-capability caching.
    if (status >= 500) {
      throw new Error(`CypherGoat returned error code ${status}`)
    }

    let message: string | undefined
    try {
      message = asCypherGoatError(JSON.parse(body)).error
    } catch (error: unknown) {
      message = undefined
    }

    if (message != null) {
      const match = minimumRe.exec(message)
      if (match != null) {
        // The minimum is always quoted in the SOURCE coin, so it is a 'from'
        // limit regardless of which side the user pinned.
        const nativeMin = toNativeAmount(
          request.fromWallet,
          match[1],
          request.fromTokenId,
          'up'
        )
        throw new SwapBelowLimitError(swapInfo, nativeMin, 'from')
      }
    }

    throw new SwapCurrencyError(swapInfo, request)
  }

  /**
   * Estimate step: resolve the pair, price it across CypherGoat's exchanges,
   * pick the best one, and enforce the minimum.
   *
   * This step creates NO order, which is what makes it safe to run as the
   * `getMaxSwappable` probe (see `fetchProbeOrder`).
   *
   * There is no `enforceMax` flag here, unlike the template: CypherGoat
   * publishes no maximum anywhere. A live 100,000 BTC estimate returns 200 with
   * ordinary-looking rates, so the plugin has nothing to clamp a max-swap probe
   * against and never throws `SwapAboveLimitError`. Should CypherGoat start
   * reporting a ceiling, add the flag along with it rather than enforcing the
   * new limit on the probe path.
   */
  const fetchQuote = async (
    request: EdgeSwapRequestPlugin
  ): Promise<{
    rate: ReturnType<typeof asCypherGoatRate>
    estimateId?: number
    sendAmount: string
    fromAsset: CypherGoatAsset
    toAsset: CypherGoatAsset
    fromAddress: string
    toAddress: string
  }> => {
    const { fromTokenId, fromWallet, quoteFor, toTokenId, toWallet } = request

    // CypherGoat prices a swap only from a SOURCE amount: `/estimate` takes an
    // `amount` in `coin1` and has no destination-amount form. A reverse quote
    // is therefore a pair this plugin cannot serve, which is a currency error
    // rather than a hard failure, so the GUI simply omits CypherGoat instead of
    // failing the swap screen for every other provider too.
    if (quoteFor === 'to') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromAsset = getAsset(fromWallet, fromTokenId)
    const toAsset = getAsset(toWallet, toTokenId)
    if (fromAsset == null || toAsset == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet),
      getAddress(toWallet)
    ])

    // CypherGoat speaks DENOMINATED amounts, confirmed against a live response:
    // a 0.01 BTC estimate is sent as `amount=0.01` and answers with XMR figures
    // like `1.4523216420223595`, not native units.
    const sendAmount = nativeToDenomination(
      fromWallet,
      request.nativeAmount,
      fromTokenId
    )

    const estimateParams = new URLSearchParams({
      coin1: fromAsset.coin,
      network1: fromAsset.network,
      coin2: toAsset.coin,
      network2: toAsset.network,
      amount: sendAmount
    })

    const response = await fetchCors(
      `${apiBaseUrl}/estimate?${estimateParams.toString()}`,
      { headers }
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      log.warn(`CypherGoat estimate error ${response.status}: ${text}`)
      classifyEstimateError(request, response.status, text)
    }

    const responseJson = await response.json()
    let estimate
    try {
      estimate = asCypherGoatEstimate(responseJson)
    } catch (error: unknown) {
      log.warn(
        'Unexpected CypherGoat estimate response:',
        JSON.stringify(responseJson)
      )
      throw error
    }

    const { Results: results } = estimate.rates
    // A mapped pair CypherGoat could not price. Currency error, so the GUI drops
    // this provider rather than hard-failing: provider coverage goes stale, so
    // mapped-but-unquotable is a steady state, not an edge case.
    if (results.length === 0) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Pick the best payout. The API returns `Results` already sorted, but the
    // choice is re-derived here rather than trusting that ordering, and the
    // comparison goes through `biggystring`: these are high-precision decimal
    // strings, and float comparison misorders large or close values.
    const rate = results.reduce((best, candidate) =>
      gt(candidate.Amount, best.Amount) ? candidate : best
    )

    // Enforce the minimum against the USER'S REQUESTED amount, never against an
    // amount echoed back by the provider: a provider that silently clamps an
    // out-of-range request returns an in-range echo, which would let the swap
    // proceed for less than the user asked.
    if (estimate.min !== '0') {
      const nativeMin = toNativeAmount(
        fromWallet,
        estimate.min,
        fromTokenId,
        'up'
      )
      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin, 'from')
      }
    }

    return {
      rate,
      estimateId: estimate.rates.EstimateId,
      sendAmount,
      fromAsset,
      toAsset,
      fromAddress,
      toAddress
    }
  }

  /**
   * `getMaxSwappable` probe: build a `SwapOrder` from an estimate ALONE, so
   * `getMaxSpendable` can price the network fee before any real order, and its
   * deposit address, exists. The trimmed amount it computes is then run through
   * `fetchSwapQuoteInner`, which creates exactly one order.
   */
  const fetchProbeOrder = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromAddress } = await fetchQuote(request)
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          // The user's own from-chain address stands in for the deposit address
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
      fromNativeAmount: request.nativeAmount,
      expirationDate: ensureInFuture(new Date(Date.now() + expirationMs))
    }
  }

  /**
   * The ONLY call that creates an order. Runs once per swap, after
   * `getMaxSwappable` has settled on the final amount.
   */
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromTokenId, fromWallet, toTokenId, toWallet } = request
    // Reuse the assets `fetchQuote` already resolved, so the order is created
    // for exactly the pair that was priced.
    const {
      estimateId,
      fromAddress,
      fromAsset,
      rate,
      sendAmount,
      toAddress,
      toAsset
    } = await fetchQuote(request)

    const swapParams = new URLSearchParams({
      coin1: fromAsset.coin,
      network1: fromAsset.network,
      coin2: toAsset.coin,
      network2: toAsset.network,
      amount: sendAmount,
      // Route the order to the exchange the estimate picked.
      partner: rate.Exchange,
      address: toAddress,
      source: sourceTag
    })
    if (estimateId != null) {
      swapParams.append('estimateid', String(estimateId))
    }
    if (affiliateId != null) {
      swapParams.append('affiliate', affiliateId)
    }

    const orderResponse = await fetchCors(
      `${apiBaseUrl}/swap?${swapParams.toString()}`,
      { headers }
    )
    if (!orderResponse.ok) {
      const text = await orderResponse.text().catch(() => '')
      log.warn(`CypherGoat swap error ${orderResponse.status}: ${text}`)
      // Deliberately NOT classified. `/swap` serializes a Go `error` value, so
      // its body is `{"error":{}}` and carries no code, message or limit to
      // classify on. Guessing from the status alone would report an unsupported
      // pair for a transient order-creation failure, so this stays a generic
      // error until CypherGoat returns a real one.
      throw new Error(`CypherGoat returned error code ${orderResponse.status}`)
    }

    const orderJson = await orderResponse.json()
    let order
    try {
      order = asCypherGoatOrder(orderJson).transaction
    } catch (error: unknown) {
      log.warn(
        'Unexpected CypherGoat swap response:',
        JSON.stringify(orderJson)
      )
      throw error
    }

    // The receive amount rounds DOWN, so the figure shown to the user is never
    // larger than what the provider actually sends.
    const payoutNativeAmount = toNativeAmount(
      toWallet,
      order.EstimateAmount,
      toTokenId,
      'down'
    )

    // TRUST BOUNDARY. The spend below is signed for `request.nativeAmount`, the
    // exact integer the user chose, rather than for CypherGoat's echoed
    // `SendAmount`: the echo is a float round-trip of the decimal string this
    // plugin sent, so using it would risk depositing a rounded-off amount.
    //
    // The echo is still checked, because a response asking for MORE than the
    // user requested means the order is not the one that was quoted.
    if (order.SendAmount != null) {
      const echoedNativeAmount = toNativeAmount(
        fromWallet,
        order.SendAmount,
        fromTokenId,
        'down'
      )
      if (gt(echoedNativeAmount, request.nativeAmount)) {
        throw new Error(
          'CypherGoat returned a source amount above the requested amount'
        )
      }
    }

    const memos: EdgeMemo[] =
      order.Memo == null
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: order.Memo
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          publicAddress: order.Address
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
        orderId: order.CGID,
        orderUri: orderUri + order.CGID,
        // CypherGoat quotes floating rates only: `/estimate` exposes no rate
        // type and guarantees no figure, so the receive amount is always an
        // estimate. Hardcoding `false` would show the user a locked amount on a
        // route that can deliver less.
        isEstimate: true,
        toAsset: {
          pluginId: toWallet.currencyInfo.pluginId,
          tokenId: toTokenId,
          nativeAmount: payoutNativeAmount
        },
        fromAsset: {
          pluginId: fromWallet.currencyInfo.pluginId,
          tokenId: fromTokenId,
          nativeAmount: request.nativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: toWallet.id,
        // CypherGoat's `/swap` takes no refund address, so a failed order is
        // refunded by whichever underlying exchange ran it, through its own
        // support flow. The address is still saved for the user's records.
        refundAddress: fromAddress
      }
    }

    log('spendInfo', spendInfo)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: request.nativeAmount,
      expirationDate: ensureInFuture(new Date(Date.now() + expirationMs))
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      // Reject blocked assets and same-asset (self) swaps CLIENT-SIDE, before
      // any provider endpoint is hit. This shared helper also carries the
      // repo-wide `defaultInvalidCodes` list.
      checkInvalidTokenIds({ from: {}, to: {} }, request, swapInfo)

      // A 'max' request arrives carrying the wallet's RAW, pre-fee balance.
      // `getMaxSwappable` probes with `fetchProbeOrder` to price network fees,
      // rewrites the request as a 'from' quote for the spendable remainder, and
      // only then does the real pass below create an order.
      const newRequest = await getMaxSwappable(fetchProbeOrder, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
