import { ceil, floor, gt, lt } from 'biggystring'
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
  EdgeToken,
  EdgeTokenId,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import {
  stealthex as stealthexMapping,
  StealthexChain
} from '../../mappings/stealthex'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkInvalidTokenIds,
  ensureInFuture,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  getAddress,
  memoType,
  nativeToDenomination
} from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'stealthex'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'StealthEX',
  supportEmail: 'support@stealthex.io'
}

const asInitOptions = asObject({
  apiKey: asString
})

const API_BASE_URL = 'https://api.stealthex.io/v4'
const ORDER_BASE_URL = 'https://stealthex.io/exchange/?id='

const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

/** StealthEX identifies an asset by its symbol on a specific network */
interface StealthexAsset {
  symbol: string
  network: string
}

type StealthexRate = 'fixed' | 'floating'

/**
 * `reversed` estimation quotes by the amount the user receives, and StealthEX
 * only offers it on fixed rate routes.
 */
type StealthexEstimation = 'direct' | 'reversed'

/**
 * One asset in StealthEX's catalog. `rates` is cleaned as plain strings so a
 * rate type StealthEX adds later cannot invalidate every listing.
 */
const asStealthexCurrency = asObject({
  symbol: asString,
  network: asString,
  rates: asArray(asString),
  contract_address: asEither(asString, asNull)
})
type StealthexCurrency = ReturnType<typeof asStealthexCurrency>

/** A malformed listing drops itself rather than the whole catalog page */
const asStealthexCurrencies = asArray(asMaybe(asStealthexCurrency))

/** The body both `/rates/estimated-amount` and `/exchanges` are built on */
interface StealthexEstimateBody {
  route: { from: StealthexAsset; to: StealthexAsset }
  estimation: StealthexEstimation
  rate: StealthexRate
  amount: number
}

const asStealthexRange = asObject({
  min_amount: asNumberString,
  max_amount: asOptional(asNumberString)
})

const asStealthexEstimate = asObject({
  estimated_amount: asNumberString,
  // Only fixed rate estimates come with a rate to lock in:
  rate: asOptional(asObject({ id: asString }))
})

/**
 * A deposit memo / destination tag. StealthEX documents it as a string, but a
 * numeric tag (XRP, and other tag chains) would arrive as a JSON number, and a
 * cleaner that only accepts strings would fail the whole order response. An
 * absent or blank value means the chain takes no memo.
 */
const asStealthexExtraId = asOptional(asEither(asString, asNumber, asNull))

const asStealthexExchange = asObject({
  id: asString,
  deposit: asObject({
    expected_amount: asNumberString,
    address: asString,
    extra_id: asStealthexExtraId
  }),
  withdrawal: asObject({
    expected_amount: asNumberString
  }),
  created_at: asDate,
  expires_at: asOptional(asDate)
})

/**
 * Every StealthEX failure comes back as `{err: {kind, details}}`, and the kind
 * is what distinguishes a bad pair from a bad amount.
 */
const asStealthexError = asMaybe(
  asJSON(asObject({ err: asObject({ kind: asString, details: asString }) }))
)

/** Error kinds that mean StealthEX cannot swap this pair at all */
const NO_ROUTE_KINDS = [
  'NoPair',
  'NoExchangeRoute',
  'RouteIsDisabled',
  'MarketUnavailable'
]

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

/** Fixed rate orders expire on their own, so a floating order needs a window */
const FLOATING_EXPIRATION_MS = 1000 * 60 * 20

/** `/currencies` pages at 250 listings, and the catalog runs about 1000 */
const CATALOG_PAGE_SIZE = 250
const CATALOG_MAX_PAGES = 40
/** Pages fetched at once after the first, so a quote is not stuck serially */
const CATALOG_PAGE_BATCH = 4
/** Rebuilds of a token index racing a catalog refresh before serving uncached */
const TOKEN_INDEX_ATTEMPTS = 3
const CATALOG_CACHE_MS = 1000 * 60 * 60

export function makeStealthexPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  // StealthEX blocks browser-origin requests via CORS, and swap plugins run
  // inside a WebView:
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`
  }

  /**
   * StealthEX's whole asset catalog, indexed by provider network. It carries
   * each listing's symbol, contract address and supported rate types, which is
   * everything a quote needs to identify an asset.
   */
  let catalog = new Map<string, StealthexCurrency[]>()
  let catalogUpdated = 0
  let catalogErrorKind: string | undefined
  let catalogFetch: Promise<void> | undefined

  /**
   * Edge tokenId to catalog listing, per `pluginId:network`, derived from
   * `catalog`. Canonicalizing a contract address costs a call into the currency
   * plugin and one network carries hundreds of listings, so a derived index
   * lives until the catalog it came from is replaced.
   */
  const tokenIndexes = new Map<
    string,
    { stamp: number; byTokenId: Map<string, StealthexCurrency> }
  >()

  /**
   * Returns the parsed JSON body, or the StealthEX error kind when the request
   * failed with a recognizable error envelope.
   */
  const fetchStealthex = async (
    path: string,
    body?: unknown
  ): Promise<{ json?: unknown; errorKind?: string }> => {
    const response = await fetchCors(`${API_BASE_URL}${path}`, {
      headers,
      method: body == null ? 'GET' : 'POST',
      body: body == null ? undefined : JSON.stringify(body)
    })
    const text = await response.text()

    if (!response.ok) {
      log.warn(`StealthEX ${path} returned ${response.status}: ${text}`)
      const error = asStealthexError(text)
      if (error != null) return { errorKind: error.err.kind }
      throw new Error(`StealthEX returned error code ${response.status}`)
    }

    try {
      return { json: JSON.parse(text) }
    } catch (error: unknown) {
      throw new Error(`StealthEX returned invalid JSON: ${text}`)
    }
  }

  /** Turns an unexpected error kind into an error worth logging */
  const unexpectedError = (path: string, errorKind: string): Error =>
    new Error(`StealthEX ${path} failed with ${errorKind}`)

  /**
   * Maps a StealthEX error kind onto the Edge error it actually means. Every
   * call site shares this so the same kind cannot mean an unsupported pair on
   * one path and a generic plugin failure on another.
   */
  const stealthexError = (
    path: string,
    errorKind: string,
    request: EdgeSwapRequestPlugin
  ): Error => {
    if (NO_ROUTE_KINDS.includes(errorKind)) {
      return new SwapCurrencyError(swapInfo, request)
    }
    // StealthEX does not say what it is refusing, so do not claim a reason:
    if (errorKind === 'NotAllowed') return new SwapPermissionError(swapInfo)
    return unexpectedError(path, errorKind)
  }

  /**
   * Refreshes the catalog once its TTL has lapsed. StealthEX renames listings,
   * delists assets, corrects contract addresses and changes which pairs support
   * fixed rates, so a catalog cached for the life of the app eventually quotes
   * assets that no longer exist.
   *
   * The new catalog replaces the old one only after every page arrived and the
   * result is non-empty. A failed or empty refresh keeps the previous good
   * catalog and leaves the stamp expired, so the next quote retries instead of
   * caching an outage for the full TTL.
   */
  const refreshCatalog = async (): Promise<void> => {
    catalogErrorKind = undefined

    const fetchPage = async (
      page: number
    ): Promise<{ listings: StealthexCurrency[]; full: boolean }> => {
      const offset = page * CATALOG_PAGE_SIZE
      const path = `/currencies?limit=${CATALOG_PAGE_SIZE}&offset=${offset}`
      const { json, errorKind } = await fetchStealthex(path)
      if (errorKind != null || json == null) {
        catalogErrorKind = errorKind
        throw unexpectedError(path, errorKind ?? 'no response body')
      }
      // A malformed listing drops itself rather than the whole page, so the
      // raw count, not the kept count, says whether more pages follow:
      const cleaned = asStealthexCurrencies(json)
      return {
        listings: cleaned.filter(
          (currency): currency is StealthexCurrency => currency != null
        ),
        full: cleaned.length === CATALOG_PAGE_SIZE
      }
    }

    const out = new Map<string, StealthexCurrency[]>()
    let count = 0
    const add = (listings: StealthexCurrency[]): void => {
      for (const currency of listings) {
        const network = out.get(currency.network) ?? []
        network.push(currency)
        out.set(currency.network, network)
        ++count
      }
    }

    try {
      // The first page reports whether there is anything to page through, and
      // the rest go out together: the catalog runs to about a thousand
      // listings, and fetching five pages one after another makes the first
      // quote of the hour wait on five round trips.
      let more = await fetchPage(0)
      add(more.listings)
      let page = 1
      while (more.full && page < CATALOG_MAX_PAGES) {
        const batch = []
        for (
          let i = 0;
          i < CATALOG_PAGE_BATCH && page + i < CATALOG_MAX_PAGES;
          ++i
        ) {
          batch.push(fetchPage(page + i))
        }
        const pages = await Promise.all(batch)
        for (const fetched of pages) add(fetched.listings)
        page += pages.length
        more = pages[pages.length - 1]
      }
    } catch (error: unknown) {
      log.warn('StealthEX: could not update the currency catalog', error)
      return
    }

    if (count === 0) {
      log.warn('StealthEX: the currency catalog came back empty')
      return
    }
    catalog = out
    catalogUpdated = Date.now()
  }

  /** Refreshes the catalog on a lapsed TTL, one refresh per set of callers */
  const updateCatalog = async (): Promise<void> => {
    if (catalogUpdated > Date.now() - CATALOG_CACHE_MS) return
    if (catalogFetch == null) {
      catalogFetch = refreshCatalog().finally(() => {
        catalogFetch = undefined
      })
    }
    await catalogFetch
  }

  /** Canonicalizes one catalog snapshot's contracts into an Edge tokenId map */
  const buildTokenIndex = async (
    wallet: EdgeCurrencyWallet,
    listings: StealthexCurrency[]
  ): Promise<Map<string, StealthexCurrency>> => {
    const byTokenId = new Map<string, StealthexCurrency>()
    for (const currency of listings) {
      const contractAddress = currency.contract_address
      if (contractAddress == null) continue

      const token: EdgeToken = {
        currencyCode: 'FAKE',
        denominations: [{ name: 'FAKE', multiplier: '1' }],
        displayName: 'FAKE',
        networkLocation: { contractAddress }
      }
      try {
        const tokenId = await wallet.currencyConfig.getTokenId(token)
        if (tokenId != null) byTokenId.set(tokenId, currency)
      } catch (error: unknown) {
        // Not an address this chain recognizes, so not this chain's token
      }
    }
    return byTokenId
  }

  /**
   * Builds, or reuses, the `tokenId` to listing index for one wallet's chain on
   * one StealthEX network. Provider contract addresses are canonicalized
   * through the wallet's own currency plugin, so casing and formatting
   * differences cannot cause a false mismatch, and a listing whose
   * `contract_address` is not a real address on this chain drops out.
   */
  const getTokenIndex = async (
    wallet: EdgeCurrencyWallet,
    network: string
  ): Promise<Map<string, StealthexCurrency>> => {
    const key = `${wallet.currencyInfo.pluginId}:${network}`

    // Each pass builds from ONE catalog snapshot and only caches the result if
    // that snapshot is still current: canonicalizing a contract awaits the
    // currency plugin, and a refresh landing during those awaits would
    // otherwise stamp an index built from the old catalog as if it came from
    // the new one, freezing stale symbol/network rows in for the whole TTL.
    for (let attempt = 0; attempt < TOKEN_INDEX_ATTEMPTS; ++attempt) {
      const cached = tokenIndexes.get(key)
      if (cached != null && cached.stamp === catalogUpdated) {
        return cached.byTokenId
      }

      const stamp = catalogUpdated
      const listings = catalog.get(network) ?? []
      const byTokenId = await buildTokenIndex(wallet, listings)

      if (catalogUpdated !== stamp) continue
      tokenIndexes.set(key, { stamp, byTokenId })
      return byTokenId
    }

    // The catalog kept moving underneath, so serve this quote from the current
    // snapshot without caching an index that may already be behind:
    return await buildTokenIndex(wallet, catalog.get(network) ?? [])
  }

  /**
   * The catalog listing for a wallet's asset, resolved by contract address
   * rather than by ticker. Symbols are not unique across listings and StealthEX
   * does not always spell a token the way Edge does, so a ticker match is both
   * unsafe and needlessly narrow. Returns undefined when StealthEX does not
   * list the asset.
   */
  const resolveListing = async (
    wallet: EdgeCurrencyWallet,
    tokenId: EdgeTokenId,
    chain: StealthexChain
  ): Promise<StealthexCurrency | undefined> => {
    if (tokenId == null) {
      // A native asset is matched on the mapped symbol and network alone.
      // `symbol` plus `network` is unique across the whole catalog, so the
      // pair already identifies the asset, while requiring a null contract
      // address drops every chain whose native listing carries a
      // PSEUDO-CONTRACT instead: ETH on `base` is `baseeth`, AVAX on `avax-c`
      // is `cchain`, ATOM is `atom1`, Vaulta is `core.vaulta`, and AXL is an
      // IBC denom. None of those are addresses on their own chain, so they
      // never survive into a token index and cannot collide with a real token.
      const listing = catalog
        .get(chain.mainnetNetwork)
        ?.find(currency => currency.symbol === chain.mainnetSymbol)

      // The caller has already established that the catalog is non-empty, so a
      // miss here means the mapping names a listing StealthEX no longer
      // carries. That is drift in this file, not a chain StealthEX never had,
      // and it is otherwise indistinguishable from an unsupported pair:
      if (listing == null) {
        log.warn(
          `StealthEX lists no ${chain.mainnetSymbol} on ${chain.mainnetNetwork}`
        )
      }
      return listing
    }

    const { tokenNetwork } = chain
    if (tokenNetwork == null) return undefined
    const byTokenId = await getTokenIndex(wallet, tokenNetwork)
    return byTokenId.get(tokenId)
  }

  /**
   * Everything a swap needs BEFORE an order exists: the route, the rate type,
   * the amount check and the estimate, plus both wallets' addresses. It creates
   * nothing, which is what lets the max probe run it against the raw balance.
   *
   * `enforceMax` is false ONLY for the probe. That call deliberately quotes the
   * whole pre-fee balance, so an above-limit balance must not abort it: a max
   * swap that fits once the network fee is subtracted would never get priced.
   * See `checkLimits` for what happens instead.
   */
  const fetchQuote = async (
    request: EdgeSwapRequestPlugin,
    enforceMax: boolean
  ): Promise<{
    rate: StealthexRate
    estimate: ReturnType<typeof asStealthexEstimate>
    estimateBody: StealthexEstimateBody
    fromAddress: string
    toAddress: string
  }> => {
    const { fromWallet, toWallet, fromTokenId, toTokenId, quoteFor } = request

    const fromChain = stealthexMapping.get(
      fromWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
    )
    const toChain = stealthexMapping.get(
      toWallet.currencyInfo.pluginId as EdgeCurrencyPluginId
    )
    if (fromChain == null || toChain == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    await updateCatalog()
    if (catalog.size === 0) {
      // A catalog outage is a provider failure, not an unsupported pair. Saying
      // otherwise would drop StealthEX out of the quote race silently and tell
      // the user the pair does not exist.
      if (catalogErrorKind === 'NotAllowed')
        throw new SwapPermissionError(swapInfo)
      throw new Error(
        `StealthEX currency catalog unavailable: ${
          catalogErrorKind ?? 'no catalog'
        }`
      )
    }

    const [fromCurrency, toCurrency] = await Promise.all([
      resolveListing(fromWallet, fromTokenId, fromChain),
      resolveListing(toWallet, toTokenId, toChain)
    ])
    if (fromCurrency == null || toCurrency == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    const route: StealthexEstimateBody['route'] = {
      from: { symbol: fromCurrency.symbol, network: fromCurrency.network },
      to: { symbol: toCurrency.symbol, network: toCurrency.network }
    }

    // A `to` quote asks StealthEX to work backwards from the payout amount,
    // which it only does on fixed rate routes:
    const estimation: StealthexEstimation =
      quoteFor === 'to' ? 'reversed' : 'direct'
    const fixedSupported =
      fromCurrency.rates.includes('fixed') && toCurrency.rates.includes('fixed')
    if (estimation === 'reversed' && !fixedSupported) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const getRange = async (
      rate: StealthexRate
    ): Promise<ReturnType<typeof asStealthexRange> | undefined> => {
      const { json, errorKind } = await fetchStealthex('/rates/range', {
        route,
        estimation,
        rate
      })
      if (errorKind != null || json == null) {
        // A missing route is the caller's cue to try the other rate type:
        if (errorKind != null && NO_ROUTE_KINDS.includes(errorKind)) {
          return undefined
        }
        throw stealthexError('/rates/range', errorKind ?? 'unknown', request)
      }
      return asStealthexRange(json)
    }

    // The amount is denominated in whichever asset the user pinned down:
    const quoteWallet = quoteFor === 'to' ? toWallet : fromWallet
    const quoteTokenId = quoteFor === 'to' ? toTokenId : fromTokenId
    const quoteAmount = nativeToDenomination(
      quoteWallet,
      request.nativeAmount,
      quoteTokenId
    )
    const limitDirection = quoteFor === 'to' ? 'to' : 'from'

    /**
     * Checks the amount against the pair's range and returns the amount to
     * quote. Bounds round INWARD, minimums up and maximums down, so a rounded
     * limit can never sit outside what StealthEX actually accepts and send the
     * user back with an amount that fails again.
     *
     * Below the minimum always throws. Above the maximum throws only when
     * `enforceMax` is set: the max probe quotes the whole pre-fee balance, and
     * StealthEX rejects an out-of-range amount outright, so the probe quotes
     * the maximum instead. That keeps a fee estimate available, and the real
     * quote that follows raises the typed above-limit error if the balance is
     * still too large once the fee is subtracted.
     */
    const checkLimits = (
      range: ReturnType<typeof asStealthexRange>
    ): string => {
      if (lt(quoteAmount, range.min_amount)) {
        throw new SwapBelowLimitError(
          swapInfo,
          ceil(
            denominationToNative(quoteWallet, range.min_amount, quoteTokenId),
            0
          ),
          limitDirection
        )
      }
      if (range.max_amount != null && gt(quoteAmount, range.max_amount)) {
        if (!enforceMax) return range.max_amount
        throw new SwapAboveLimitError(
          swapInfo,
          floor(
            denominationToNative(quoteWallet, range.max_amount, quoteTokenId),
            0
          ),
          limitDirection
        )
      }
      return quoteAmount
    }

    /**
     * Runs one rate type end to end: the pair's range, the amount check, and
     * the estimate. Returns undefined ONLY when this rate type has no route,
     * which is the caller's cue to try the other one. Every other failure,
     * limit errors included, describes the pair rather than the rate type and
     * is thrown, so the fallback never retries something the other rate type
     * would reject the same way.
     */
    const attemptRate = async (
      rate: StealthexRate
    ): Promise<
      | {
          rate: StealthexRate
          estimate: ReturnType<typeof asStealthexEstimate>
          body: StealthexEstimateBody
        }
      | undefined
    > => {
      const range = await getRange(rate)
      if (range == null) return undefined
      const amount = checkLimits(range)

      // StealthEX rejects a string amount outright ("expected number,
      // received string"), so this is the one place a JS number is
      // unavoidable. A from-amount past float precision would be rounded here,
      // and the trust boundary in `fetchSwapQuoteInner` rejects the order if
      // that ever rounds the deposit UP past what the user requested.
      const body: StealthexEstimateBody = {
        route,
        estimation,
        rate,
        amount: Number(amount)
      }
      const { json, errorKind } = await fetchStealthex(
        '/rates/estimated-amount',
        body
      )
      if (errorKind != null || json == null) {
        if (errorKind != null && NO_ROUTE_KINDS.includes(errorKind)) {
          return undefined
        }
        throw stealthexError(
          '/rates/estimated-amount',
          errorKind ?? 'unknown',
          request
        )
      }
      const estimate = asStealthexEstimate(json)

      // A fixed order is only fixed if StealthEX returned a rate to lock in.
      // Creating the order without one leaves the payout floating while the
      // quote claims a guaranteed amount, so treat it as no fixed route:
      if (rate === 'fixed' && estimate.rate == null) {
        log.warn('StealthEX returned a fixed estimate carrying no rate id')
        return undefined
      }
      return { rate, estimate, body }
    }

    // Both assets listing `fixed` does not mean the PAIR has a fixed route.
    // StealthEX does publish per-route rate types, on
    // `/v4/currencies/available-routes`, but that endpoint hands back every
    // pair it knows in one response, about 507k of them and 66 MB, with
    // `direction` as its only filter, so a client cannot ask it about one
    // route. The fallback compensates for that one missing capability and
    // nothing else:
    // it runs only when the fixed route is absent, never on a limit or
    // unsupported-pair failure, and no order exists yet at this point, so
    // neither attempt can create a second one. Drop it once StealthEX reports
    // per-route rate types (see the ask in docs/API_REQUIREMENTS.md).
    // A reversed estimate has no floating equivalent, so it never falls back.
    const attempt =
      (fixedSupported ? await attemptRate('fixed') : undefined) ??
      (estimation === 'direct' ? await attemptRate('floating') : undefined)
    if (attempt == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    const { rate, estimate, body: estimateBody } = attempt

    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet, addressTypeMap[fromWallet.currencyInfo.pluginId]),
      getAddress(toWallet, addressTypeMap[toWallet.currencyInfo.pluginId])
    ])

    return { rate, estimate, estimateBody, fromAddress, toAddress }
  }

  /**
   * `getMaxSwappable` probe: build a SwapOrder from the quote ALONE, so
   * `getMaxSpendable` can price the network fee without a StealthEX order
   * existing. Every max swap runs the quote function twice, so a probe that
   * created an order would leave the first one abandoned, holding a deposit
   * address and a locked fixed rate nobody will ever pay into.
   */
  const fetchProbeOrder = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromAddress } = await fetchQuote(request, false)

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          // `getMaxSwappable` strips this amount before pricing the fee; it is
          // the address that has to be real, and the user's own from-chain
          // address stands in for the deposit address that does not exist yet.
          nativeAmount: request.nativeAmount,
          publicAddress: fromAddress
        }
      ],
      networkFeeOption: 'high',
      // This spend is never broadcast. Its target is the user's own address,
      // which engines that compare the target against their own public key
      // reject with `SpendToSelfError` (every EVM chain, where the public key
      // IS the address). That error escapes `getMaxSwappable` and fails every
      // max swap from an EVM wallet. The real order below keeps all checks.
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
      expirationDate: ensureInFuture(
        new Date(Date.now() + FLOATING_EXPIRATION_MS)
      )
    }
  }

  /**
   * The ONLY call that creates an order, and it runs once per swap: the max
   * probe above has already settled the final amount by the time it does.
   */
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, fromTokenId, toTokenId } = request
    const {
      rate,
      estimate,
      estimateBody,
      fromAddress,
      toAddress
    } = await fetchQuote(request, true)

    const exchangeReply = await fetchStealthex('/exchanges', {
      ...estimateBody,
      // `attemptRate` guarantees a fixed estimate carries one, so the order is
      // locked at exactly the rate the quote showed:
      ...(estimate.rate == null ? {} : { rate_id: estimate.rate.id }),
      address: toAddress,
      refund_address: fromAddress
    })
    if (exchangeReply.errorKind != null || exchangeReply.json == null) {
      throw stealthexError(
        '/exchanges',
        exchangeReply.errorKind ?? 'unknown',
        request
      )
    }
    const exchange = asStealthexExchange(exchangeReply.json)

    // StealthEX quotes more decimal places than a token may support, and native
    // amounts have to be whole atomic units:
    const fromNativeAmount = floor(
      denominationToNative(
        fromWallet,
        exchange.deposit.expected_amount,
        fromTokenId
      ),
      0
    )
    const toNativeAmount = floor(
      denominationToNative(
        toWallet,
        exchange.withdrawal.expected_amount,
        toTokenId
      ),
      0
    )

    // TRUST BOUNDARY. `fromNativeAmount` comes out of StealthEX's response and
    // is about to become a SIGNED SPEND, so bound it by what the user asked
    // for: a malformed or compromised response must not be able to move more of
    // the source asset than the quote showed. Only a 'from' quote pins the
    // source amount locally (a max quote arrives here as one). On a reversed
    // quote the user pinned the RECEIVE amount, so the source side is
    // StealthEX's to determine and there is nothing local to bound it against.
    if (
      request.quoteFor === 'from' &&
      gt(fromNativeAmount, request.nativeAmount)
    ) {
      throw new Error(
        'StealthEX returned a deposit amount above the requested amount'
      )
    }

    // A numeric tag arrives as a JSON number, and an empty string means the
    // chain takes no memo, so neither may become an EdgeMemo as-is:
    const extraId = exchange.deposit.extra_id
    const memoValue = extraId == null ? '' : String(extraId)
    const memos: EdgeMemo[] =
      memoValue === ''
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: memoValue
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: exchange.deposit.address
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
        orderId: exchange.id,
        orderUri: ORDER_BASE_URL + exchange.id,
        isEstimate: rate === 'floating',
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
        payoutWalletId: toWallet.id,
        refundAddress: fromAddress
      }
    }

    // Floating rate orders never expire, so give the user the same window a
    // fixed rate order gets:
    const expirationDate =
      exchange.expires_at ??
      new Date(exchange.created_at.getTime() + FLOATING_EXPIRATION_MS)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: ensureInFuture(expirationDate)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)

      // The probe quotes without creating an order; `fetchSwapQuoteInner` then
      // creates exactly one, for the amount the probe settled on:
      const newRequest = await getMaxSwappable(fetchProbeOrder, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
