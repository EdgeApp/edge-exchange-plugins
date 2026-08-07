import { ceil, floor, gt, lt } from 'biggystring'
import {
  asArray,
  asEither,
  asJSON,
  asMaybe,
  asNull,
  asObject,
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
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { swapter as swapterMapping } from '../../mappings/swapter'
import {
  ChainCodeTickerMap,
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  EdgeIdSwapIdMap,
  ensureInFuture,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToRecord,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin } from '../types'
import { asOptionalBlank } from './changenow'

const pluginId = 'swapter'
const orderUri = 'https://swapter.io/exchange-status/'
const apiBaseUrl = 'https://api.swapter.io'

/** Swapter returns no quote expiration, so bound it locally. */
const EXPIRATION_MS = 1000 * 60 * 30

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60 // 1 hour

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Swapter',
  supportEmail: 'support@swapter.io'
}

const asInitOptions = asObject({ apiKey: asString })

const asSwapterNetwork = asObject({
  network: asString,
  contract: asEither(asNull, asString)
})

const asSwapterAssetsResponse = asObject({
  assets: asArray(
    asObject({
      currency: asString,
      networks: asObject({
        deposit: asArray(asSwapterNetwork),
        withdraw: asArray(asSwapterNetwork)
      })
    })
  )
})

const asSwapterDepositRangeResponse = asObject({
  min: asNumberString,
  max: asNumberString
})

const asSwapterErrorResponse = asJSON(
  asObject({
    error: asObject({
      // Swapter sends string codes today, but its amount fields are numbers, so
      // accept either rather than silently falling back to a generic error.
      code: asNumberString,
      message: asMaybe(asString),
      // Present only on the limit rejections below, carrying the bound that was
      // violated in the deposit asset's denomination.
      min: asMaybe(asNumberString),
      max: asMaybe(asNumberString)
    })
  })
)

/**
 * Swapter reports a pair it cannot quote as a 400 with error code 1 (deposit
 * side) or 2 (withdraw side). Those are not failures: the provider simply does
 * not serve the pair, which happens whenever Swapter drops or renames an asset
 * this mapping still lists.
 */
const UNSUPPORTED_PAIR_CODES = ['1', '2']

/**
 * Codes `create` returns for a deposit amount outside the pair's range. They
 * were a single code until Swapter split them, so the only way to tell a floor
 * from a ceiling used to be string-matching their English message.
 */
const BELOW_MINIMUM_CODE = 'io.swapter.controller.swap.factory:6'
const ABOVE_MAXIMUM_CODE = 'io.swapter.controller.swap.factory:9'

/**
 * Swapter's Edge-specific adapter for the deposit range. It is the authoritative
 * floor and ceiling — `/v2/swap/min-amount` reports a LOWER minimum than
 * `create` actually enforces (0.014153 vs 0.016006 ETH on ETH->LTC), so quoting
 * against it let an amount pass this plugin's own check and then fail create.
 * The adapter route also serializes every numeric field as a string, where the
 * `/v2` route returns unquoted JSON numbers that lose precision in `JSON.parse`.
 */
const DEPOSIT_RANGE_PATH = '/adapter/edge/swap/deposit-range'

const asSwapterCreateResponse = asObject({
  uid: asString,
  deposit: asObject({
    address: asString,
    /**
     * Memo-based chains (XRP, XLM, TON…) carry a destination tag that Swapter
     * may return as a number. `asMaybe(asString)` would swallow that into
     * `undefined` and build a spend with NO memo, stranding the deposit, so
     * accept number-or-string and treat only null/blank as absent.
     */
    memo: asOptionalBlank(asNumberString)
  }),
  withdraw: asObject({
    amount: asObject({
      expected: asNumberString
    })
  })
})

/**
 * Swapter's create endpoint spells the fixed-rate type `fix`, NOT `fixed`. An
 * unrecognized type is not rejected as a bad request: the server answers 500
 * (`io.swapter.controller.swap.factory:7`), which is indistinguishable from a
 * pair it cannot fix, so sending `fixed` silently downgraded EVERY quote to the
 * floating fallback below.
 */
type SwapterSwapType = 'float' | 'fix'

/**
 * Wraps the Edge error from a create call Swapter REJECTED (non-ok response, so
 * no order was created). The fixed-then-float fallback retries ONLY on this, so
 * a failure after a successful create never spawns a second order.
 */
class SwapterCreateRejected extends Error {
  readonly edgeError: Error
  constructor(edgeError: Error) {
    super('Swapter create rejected')
    this.name = 'SwapterCreateRejected'
    this.edgeError = edgeError
  }
}

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  swapterMapping
)

/**
 * Overrides for mainnet assets whose Swapter coin code is NOT the Edge mainnet
 * ticker. `getChainAndTokenCodes` derives a mainnet coin from
 * `currencyInfo.currencyCode`, which is wrong when Swapter uses a different
 * symbol: native TON (Edge `TON`) is listed on Swapter as `GRAM`, so quotes
 * would send an unknown coin and fail min-amount/create.
 */
const SPECIAL_MAINNET_CASES: EdgeIdSwapIdMap = new Map([
  ['ton', new Map([[null, { chainCode: 'TON', tokenCode: 'GRAM' }]])],
  ['bitcoinsv', new Map([[null, { chainCode: 'BCHSV', tokenCode: 'BCHSV' }]])]
])

/**
 * Errors that describe the PAIR or the AMOUNT rather than the swap type, so
 * retrying the same request as a floating order earns the identical rejection.
 */
const PAIR_LEVEL_ERROR_NAMES = [
  'SwapCurrencyError',
  'SwapBelowLimitError',
  'SwapAboveLimitError'
]

/**
 * edge-core-js builds its swap errors with constructors that RETURN a plain
 * `Error` carrying a `name`, never `this`, so `instanceof` against them is
 * always false and silently classifies every one of them as a generic failure.
 * Match the name instead, which is the field core's own `asMaybeSwap*Error`
 * cleaners key off.
 */
const isPairLevelError = (error: unknown): boolean =>
  error instanceof Error && PAIR_LEVEL_ERROR_NAMES.includes(error.name)

/**
 * Convert a deposit-side limit from Swapter's denomination to the native units
 * Edge's limit errors carry. `denominationToNative` is a plain multiply, so a
 * bound with more decimals than the asset's denomination lands on a fractional
 * value, and native amounts must be integer atomic units. Round each bound
 * INWARD — minimums up, maximums down — so the rounding can never widen the
 * range past what Swapter accepts and let a doomed amount through.
 */
const toNativeLimit = (
  request: EdgeSwapRequestPlugin,
  amount: string,
  bound: 'min' | 'max'
): string => {
  const native = denominationToNative(
    request.fromWallet,
    amount,
    request.fromTokenId
  )
  return bound === 'min' ? ceil(native, 0) : floor(native, 0)
}

export function makeSwapterPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'X-API-KEY': initOptions.apiKey,
    Accept: 'application/json'
  }

  /**
   * `/data/coins` is public and rejects any request that carries an
   * `X-API-KEY` header at all — it answers 401 for a valid-format key, a
   * garbage key and an empty value alike, but 200 with no key. Sending the key
   * here would leave the ticker map permanently empty, which is silent: the
   * failure is only warned, and every token quote then dies in
   * `getChainAndTokenCodes` with `SwapCurrencyError`.
   */
  const publicHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const response = await fetchCors(apiBaseUrl + '/data/coins', {
        headers: publicHeaders
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message)
      }

      const json = await response.json()
      const { assets } = asSwapterAssetsResponse(json)

      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
      const out: ChainCodeTickerMap = new Map()

      for (const asset of assets) {
        for (const depositNetwork of asset.networks.deposit) {
          const canWithdraw = asset.networks.withdraw.some(
            withdrawNetwork =>
              withdrawNetwork.network === depositNetwork.network &&
              withdrawNetwork.contract === depositNetwork.contract
          )

          if (!canWithdraw) continue
          if (!chaincodeArray.includes(depositNetwork.network)) continue

          const tokenCodes = out.get(depositNetwork.network) ?? []

          tokenCodes.push({
            tokenCode: asset.currency,
            contractAddress: depositNetwork.contract ?? null
          })

          out.set(depositNetwork.network, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e: unknown) {
      log.warn('Swapter: Error updating supported assets', e)
    }
  }

  /**
   * Translate a non-ok Swapter response into the right Edge error. An
   * unquotable pair becomes `SwapCurrencyError` so the GUI drops Swapter for
   * this request; anything else is a real provider failure and surfaces as one.
   */
  const swapterError = (
    stage: string,
    status: number,
    text: string,
    request: EdgeSwapRequestPlugin,
    logError: boolean = true
  ): Error => {
    const errorResponse = asMaybe(asSwapterErrorResponse)(text)
    if (errorResponse != null) {
      const { code, min, max } = errorResponse.error

      if (UNSUPPORTED_PAIR_CODES.includes(code)) {
        return new SwapCurrencyError(swapInfo, request)
      }

      // The deposit range is quoted live and moves with the rate, so an amount
      // that cleared the range check above can still be out of bounds by the
      // time `create` runs. Carry the bound Swapter rejected against, so the
      // user is told the real limit instead of a generic provider failure.
      if (code === BELOW_MINIMUM_CODE && min != null) {
        return new SwapBelowLimitError(
          swapInfo,
          toNativeLimit(request, min, 'min')
        )
      }
      if (code === ABOVE_MAXIMUM_CODE && max != null) {
        return new SwapAboveLimitError(
          swapInfo,
          toNativeLimit(request, max, 'max')
        )
      }
    }
    // The fixed-rate attempt is expected to fail for pairs Swapter cannot fix
    // (it 500s), and the caller falls back to a float quote, so suppress the
    // warning there rather than logging a provider error on every quote.
    if (logError) log.warn(`Swapter ${stage} API error response:`, text)
    return new Error(`Swapter ${stage} returned error code ${status}`)
  }

  /**
   * Shared quote setup: gate the direction, resolve Swapter's asset codes and
   * both addresses, and enforce the pair's deposit range. Creates NO order, so
   * both the probe and the real quote can call it.
   *
   * `enforceMax` is false only for the probe: a max-swap probe deliberately
   * quotes the whole pre-fee balance to discover the ceiling, so a balance above
   * the range must clamp through `getMaxSpendable` rather than throw
   * `SwapAboveLimitError` on an amount the user never asked to send.
   */
  const fetchQuoteBase = async (
    request: EdgeSwapRequestPlugin,
    enforceMax: boolean
  ): Promise<{
    swapterCodes: {
      fromCurrencyCode: string
      fromMainnetCode: string
      toCurrencyCode: string
      toMainnetCode: string
    }
    sourceAmount: string
    fromAddress: string
    toAddress: string
  }> => {
    const { fromWallet, toWallet, quoteFor } = request

    // Swapter's create endpoint only accepts a deposit amount, so reverse
    // quotes are unsupported. `max` never reaches here: `getMaxSwappable`
    // rewrites it into a `from` quote before either quote path runs.
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const swapterCodes = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION,
      SPECIAL_MAINNET_CASES
    )

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet),
      getAddress(toWallet)
    ])

    // Convert the native amount to a denomination:
    const sourceAmount = nativeToDenomination(
      fromWallet,
      request.nativeAmount,
      request.fromTokenId
    )

    const depositRangeResponse = await fetchCors(
      apiBaseUrl + DEPOSIT_RANGE_PATH,
      {
        headers,
        method: 'POST',
        body: JSON.stringify({
          deposit: {
            coin: swapterCodes.fromCurrencyCode,
            network: swapterCodes.fromMainnetCode
          },
          withdraw: {
            coin: swapterCodes.toCurrencyCode,
            network: swapterCodes.toMainnetCode
          }
        })
      }
    )

    if (!depositRangeResponse.ok) {
      const text = await depositRangeResponse.text()
      throw swapterError(
        'deposit range',
        depositRangeResponse.status,
        text,
        request
      )
    }

    const depositRangeJson = await depositRangeResponse.json()
    const { min, max } = asSwapterDepositRangeResponse(depositRangeJson)

    if (lt(sourceAmount, min)) {
      throw new SwapBelowLimitError(
        swapInfo,
        toNativeLimit(request, min, 'min')
      )
    }

    if (enforceMax && gt(sourceAmount, max)) {
      throw new SwapAboveLimitError(
        swapInfo,
        toNativeLimit(request, max, 'max')
      )
    }

    return { swapterCodes, sourceAmount, fromAddress, toAddress }
  }

  /**
   * `getMaxSwappable` probe: build a `SwapOrder` from the minimum check alone,
   * targeting the user's own refund address so `getMaxSpendable` can estimate
   * fees WITHOUT creating an abandoned Swapter order. Only the `spendInfo`
   * shape is used to price fees, so no quote endpoint is needed here; the
   * trimmed amount it computes is then run through `fetchSwapQuoteInner`, which
   * creates exactly one order and returns the authoritative amounts.
   */
  const fetchProbeOrder = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromAddress } = await fetchQuoteBase(request, false)

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          publicAddress: fromAddress
        }
      ],
      networkFeeOption: 'high',
      // This probe is never broadcast: it exists only so `getMaxSpendable` can
      // price the network fee before the real order (and its deposit address)
      // exists. Its target is the user's own from-address, which EVM engines
      // reject with `SpendToSelfError` (the public key IS the address), throwing
      // out of `getMaxSwappable` and failing every max swap from an EVM wallet.
      // The real order below keeps all checks.
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
      expirationDate: ensureInFuture(new Date(Date.now() + EXPIRATION_MS))
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    swapType: SwapterSwapType,
    logCreateError: boolean = true
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet } = request
    const {
      swapterCodes,
      sourceAmount,
      fromAddress,
      toAddress
    } = await fetchQuoteBase(request, true)

    const response = await fetchCors(apiBaseUrl + '/v2/swap/create', {
      headers,
      method: 'POST',
      body: JSON.stringify({
        info: {
          type: swapType,
          refundAddress: fromAddress,
          userEmail: null
        },
        deposit: {
          coin: swapterCodes.fromCurrencyCode,
          network: swapterCodes.fromMainnetCode,
          // Send the exact denomination string. `Number(sourceAmount)` would
          // round a high-precision amount, making the order's deposit disagree
          // with the `request.nativeAmount` actually sent below. Swapter's
          // create endpoint accepts the amount as a string.
          amount: sourceAmount
        },
        withdraw: {
          coin: swapterCodes.toCurrencyCode,
          network: swapterCodes.toMainnetCode,
          address: toAddress,
          memo: null
        }
      })
    })

    if (!response.ok) {
      const text = await response.text()
      const error = swapterError(
        'create',
        response.status,
        text,
        request,
        logCreateError
      )
      // An unsupported pair and an out-of-range amount both apply to BOTH swap
      // types, so propagate those directly with no float retry — retrying only
      // spends another create call to earn the same rejection, and the float
      // error would then mask the limit the user needs to see. Wrap only a
      // fixed-specific rejection (Swapter 500s `type: 'fix'` on pairs it
      // cannot fix) so the fallback retries ONLY those, and never after a
      // successful create (which is thrown bare below and never double-orders).
      if (isPairLevelError(error)) throw error
      throw new SwapterCreateRejected(error)
    }
    const responseJson = await response.json()

    let quoteReply
    try {
      quoteReply = asSwapterCreateResponse(responseJson)
    } catch (error: unknown) {
      log.warn('Unexpected Swapter API response:', JSON.stringify(responseJson))
      throw error
    }

    const fromNativeAmount = request.nativeAmount

    // Floor the payout: rounding could inflate the displayed receive amount
    // above what Swapter actually sends, over-promising the user.
    const toNativeAmount = floor(
      denominationToNative(
        toWallet,
        quoteReply.withdraw.amount.expected,
        request.toTokenId
      ),
      0
    )
    const memos: EdgeMemo[] =
      quoteReply.deposit.memo == null
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: quoteReply.deposit.memo
            }
          ]

    // Make the transaction:
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteReply.deposit.address
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
        orderId: quoteReply.uid,
        orderUri: orderUri + quoteReply.uid,
        isEstimate: swapType === 'float',
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
      expirationDate: ensureInFuture(new Date(Date.now() + EXPIRATION_MS))
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      await fetchSupportedAssets()

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(fetchProbeOrder, request)

      // Prefer a fixed-rate order, falling back to a floating quote, the
      // convention the other central plugins follow (see changenow). Selecting
      // the rate from `userSettings` instead left the plugin stuck on float,
      // since the GUI never passes a `swapType`. Swapter's create endpoint 500s
      // on `type: 'fix'` for pairs it cannot fix, so that attempt is expected
      // to fail for those and its create error is not logged.
      let swapOrder: SwapOrder
      try {
        swapOrder = await fetchSwapQuoteInner(newRequest, 'fix', false)
      } catch (error: unknown) {
        // Only fall back to a floating quote when Swapter REJECTED the fixed
        // create (no order was made). Any other error (an order was created, or
        // a below-limit/unsupported error from the shared setup) propagates
        // unchanged, so it is never masked and no second order is created.
        if (!(error instanceof SwapterCreateRejected)) throw error
        try {
          swapOrder = await fetchSwapQuoteInner(newRequest, 'float')
        } catch (floatError: unknown) {
          // If the float create was ALSO cleanly rejected (no order), surface
          // the fixed-rate error so limit/currency errors keep their ranking in
          // `pickBestError`, matching the sibling plugins. If the float attempt
          // failed AFTER creating an order (e.g. an unparseable response),
          // surface THAT error, so a live float order is never masked behind the
          // fixed-rate rejection.
          if (floatError instanceof SwapterCreateRejected) throw error.edgeError
          throw floatError
        }
      }
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
