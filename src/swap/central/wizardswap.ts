import { floor, gt, toBns } from 'biggystring'
import {
  asBoolean,
  asEither,
  asMaybe,
  asNumber,
  asObject,
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
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { wizardswap as wizardswapMapping } from '../../mappings/wizardswap'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkInvalidTokenIds,
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  ensureInFuture,
  getMaxSwappable,
  makeSwapPluginQuote,
  mapToRecord,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin, StringMap } from '../types'
import { asOptionalBlank } from './changenow'

const pluginId = 'wizardswap'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'WizardSwap',
  supportEmail: 'support@wizardswap.io'
}

const asInitOptions = asObject({
  /**
   * WizardSwap treats the key as optional: it identifies an affiliate for the
   * referral share and changes nothing else about quoting or ordering. The
   * plugin therefore works unconfigured, and `api_key` is only sent when set.
   * A blank key counts as unset, so an empty env value never reaches the wire.
   */
  apiKey: asOptionalBlank(asString)
})

/**
 * Build the user-facing order URI from OUR OWN constant plus the order id.
 *
 * Never persist a partner-supplied URL into `savedAction.orderUri`. That value
 * is rendered as a tappable link in the transaction details, so taking the host
 * and scheme from an API response lets a compromised or misbehaving provider
 * steer users anywhere.
 */
const orderUri = 'https://www.wizardswap.io/?id='
const apiBaseUrl = 'https://www.wizardswap.io/api/'

/**
 * WizardSwap gives a deposit 15 minutes before the order lapses.
 */
const EXPIRATION_MS = 15 * 60 * 1000

/**
 * WizardSwap validates the Zcash payout address against `^(t)[A-Za-z0-9]{34}$`,
 * so it accepts transparent addresses only. Edge's Zcash engine returns
 * `[unified, sapling, transparent]`, which makes the default `getAddress` hand
 * back a unified address that WizardSwap rejects outright.
 */
const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

/**
 * Recognizes a decimal amount.
 *
 * WizardSwap reports quote failures as PROSE inside the same `estimated_amount`
 * field that carries a successful amount, so the value's shape is the only thing
 * separating an amount from an error. Without this test, `'Value too low.'`
 * flows onward as if it were a number.
 */
const AMOUNT_REGEX = /^[0-9]+(\.[0-9]+)?$/

/**
 * Below-minimum, spelled two different ways by the same endpoint. A JSON `false`
 * and this sentence mean the same thing, and neither carries the minimum.
 */
const BELOW_MINIMUM_MESSAGE = 'Value too low.'

/**
 * WizardSwap's catch-all failure. It is returned for a pair it does not route,
 * for an amount beyond its reserve, AND when the caller's IP is being
 * throttled, so it is NOT a usable above-limit signal: it carries no maximum,
 * and treating it as one would tell a user their amount is too high for pairs
 * the provider simply does not offer. See `handleEstimateError`.
 */
const INSUFFICIENT_LIQUIDITY_MESSAGE = 'Insufficient liquidity.'

/**
 * Response of the QUOTE step, which prices the swap and nothing else.
 *
 * Note what is NOT here: no order id, no deposit address. Those belong to the
 * order step below. Keeping them apart is what lets the max probe run the quote
 * without creating anything.
 *
 * `estimated_amount` is a union because a single field carries three different
 * kinds of answer: a decimal amount, a prose error, or a bare `false`.
 */
const asWizardSwapEstimate = asObject({
  estimated_amount: asEither(asString, asNumber, asBoolean)
})

/**
 * A REJECTED order. WizardSwap answers HTTP 200 with a fully formed body whose
 * `status` is `failed` and whose `address_from`/`address_to` are both null,
 * which is how it reports an `address_to` that its own `validation_address`
 * regex refused. Verified live 2026-09-22: a fabricated ETH payout address
 * produced exactly this body, while a real one on the same pair produced
 * `status: 'waiting'` with a deposit address. Matched BEFORE `asWizardSwapOrder`
 * so the null never surfaces to the user as a raw cleaner TypeError.
 */
const asWizardSwapFailedOrder = asObject({
  status: asValue('failed')
}).withRest

/**
 * Response of the ORDER step: WizardSwap has now committed a deposit address,
 * and this is the only call that does. `fetchSwapQuoteInner` makes it once.
 *
 * `amount_to` is the PAYOUT and `expected_amount` is the DEPOSIT. The two field
 * names read as synonyms and are not: the provider's docs define
 * `expected_amount` as the "amount in the base currency that we expect to
 * receive" and `amount_to` as the "expected amount in quote currency that the
 * user will receive". Verified live 2026-09-22 on btc to eth, where a 0.02 BTC
 * order returned `expected_amount: 0.02` next to `amount_to: 0.61202374`.
 * Reading `expected_amount` as the payout would quote every user a receive
 * amount equal to their own deposit, so it is not cleaned here at all.
 */
const asWizardSwapOrder = asObject({
  id: asString,
  address_from: asString,
  amount_from: asNumberString,
  amount_to: asNumberString,

  /**
   * Deposit tag/memo. Every asset WizardSwap currently lists reports
   * `has_extra_id: false`, so this is absent in practice, but a memo silently
   * dropped on a chain that later needs one is a lost-funds path.
   *
   * `asOptionalBlank(asNumberString)` rather than `asOptional(asString)`: a
   * NUMERIC memo would fail a string-only cleaner, and an EMPTY STRING would
   * become an empty `EdgeMemo` rather than no memo at all.
   */
  extra_id_from: asOptionalBlank(asNumberString)
})

const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  wizardswapMapping
)

/**
 * Convert a provider's decimal amount into WHOLE native (atomic) units.
 *
 * `denominationToNative` is a plain multiply, so a provider amount carrying more
 * decimals than the asset's denomination yields a FRACTIONAL native string.
 * Edge native amounts are integers everywhere.
 *
 * Always rounds DOWN, so neither the deposit nor the receive amount is ever
 * larger than what the provider will actually honor.
 */
const toNativeAmount = (
  wallet: EdgeCurrencyWallet,
  denominatedAmount: string,
  tokenId: EdgeTokenId
): string => floor(denominationToNative(wallet, denominatedAmount, tokenId), 0)

const getChainCode = (wallet: EdgeCurrencyWallet): string | null =>
  MAINNET_CODE_TRANSCRIPTION[
    wallet.currencyInfo.pluginId as EdgeCurrencyPluginId
  ]

export function makeWizardSwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { apiKey } = asInitOptions(opts.initOptions)
  const fetchCors = io.fetchCors ?? io.fetch

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }

  /**
   * WizardSwap prefixes every response body with a literal tab before the JSON,
   * so read the text and parse it rather than relying on a strict JSON reader.
   */
  const fetchJson = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetchCors(apiBaseUrl + path, {
      headers,
      method: 'POST',
      body: JSON.stringify(body)
    })
    const text = await response.text()
    if (!response.ok) {
      log.warn('WizardSwap API error response:', text)
      throw new Error(`WizardSwap returned error code ${response.status}`)
    }
    try {
      return JSON.parse(text)
    } catch (error: unknown) {
      log.warn('Unexpected WizardSwap API response:', text)
      throw error
    }
  }

  /**
   * Turn a prose failure from `/estimate` into the right Edge error.
   *
   * WizardSwap publishes no structured error object and no limits endpoint, so
   * a minimum is never available to report. `SwapBelowLimitError` accepts an
   * undefined minimum and the GUI falls back to a limit-less "amount too low"
   * message, which is accurate; inventing a figure would not be.
   */
  const handleEstimateError = (
    message: string,
    request: EdgeSwapRequestPlugin
  ): never => {
    if (message === BELOW_MINIMUM_MESSAGE) {
      throw new SwapBelowLimitError(swapInfo, undefined, 'from')
    }
    if (message === INSUFFICIENT_LIQUIDITY_MESSAGE) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    log.warn('Unknown WizardSwap estimate failure:', message)
    throw new Error(`WizardSwap returned an unknown error: ${message}`)
  }

  /**
   * Quote step. Resolves the pair, prices it, and maps provider failures.
   *
   * This step creates NO order, which is what makes it safe to run as the
   * `getMaxSwappable` probe (see `fetchProbeOrder`).
   *
   * The estimate only GATES the pair: an amount that fails here never reaches
   * the order step. Its figure is not returned, because the order's own
   * `amount_to` is what the user is quoted. The deposit amount it was priced
   * for is returned, so the order carries exactly the amount that was estimated.
   */
  const fetchEstimate = async (
    request: EdgeSwapRequestPlugin
  ): Promise<{
    fromChainCode: string
    toChainCode: string
    fromDenominatedAmount: string
    fromAddress: string
    toAddress: string
  }> => {
    const { fromWallet, toWallet, quoteFor } = request

    // WizardSwap quotes only floating rates in the deposit direction: its
    // estimate endpoint takes `amount_from` and nothing else, so a request that
    // pins the RECEIVE amount cannot be served at all.
    if (quoteFor === 'to') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // WizardSwap lists mainnet coins only, so a token on either side has no
    // route no matter which chain it sits on. Without this the chain mapping
    // would happily quote an Ethereum token as if it were ETH.
    if (request.fromTokenId != null || request.toTokenId != null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromChainCode = getChainCode(fromWallet)
    const toChainCode = getChainCode(toWallet)
    if (fromChainCode == null || toChainCode == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet, addressTypeMap[fromWallet.currencyInfo.pluginId]),
      getAddress(toWallet, addressTypeMap[toWallet.currencyInfo.pluginId])
    ])

    // A 'max' request never arrives here as 'max': `getMaxSwappable` has already
    // rewritten it into a 'from' quote for the spendable balance.
    const fromDenominatedAmount = nativeToDenomination(
      fromWallet,
      request.nativeAmount,
      request.fromTokenId
    )

    const estimateBody = {
      currency_from: fromChainCode,
      currency_to: toChainCode,
      amount_from: fromDenominatedAmount,
      ...(apiKey == null ? {} : { api_key: apiKey })
    }
    // Users export device logs into support tickets, so the affiliate key is
    // masked here instead of being printed with the rest of the request.
    log('estimateBody:', {
      ...estimateBody,
      ...(apiKey == null ? {} : { api_key: '<redacted>' })
    })

    const estimateJson = await fetchJson('estimate', estimateBody)

    let estimate
    try {
      estimate = asWizardSwapEstimate(estimateJson)
    } catch (error: unknown) {
      log.warn(
        'Unexpected WizardSwap API response:',
        JSON.stringify(estimateJson)
      )
      throw error
    }

    const { estimated_amount: estimatedAmount } = estimate

    // A bare `false` is WizardSwap's other way of saying the deposit is below
    // its minimum, and it carries no figure either.
    if (typeof estimatedAmount === 'boolean') {
      throw new SwapBelowLimitError(swapInfo, undefined, 'from')
    }
    // A JSON number below 1e-6 stringifies to exponential notation ('1e-7'),
    // which the amount test rejects, so expand it to plain decimals first.
    const toDenominatedAmount =
      typeof estimatedAmount === 'number'
        ? toBns(String(estimatedAmount))
        : estimatedAmount
    if (!AMOUNT_REGEX.test(toDenominatedAmount)) {
      handleEstimateError(toDenominatedAmount, request)
    }
    // A deposit that prices to nothing is too small to swap. Letting it through
    // would create a live order that pays out zero.
    if (!gt(toDenominatedAmount, '0')) {
      throw new SwapBelowLimitError(swapInfo, undefined, 'from')
    }

    return {
      fromChainCode,
      toChainCode,
      fromDenominatedAmount,
      fromAddress,
      toAddress
    }
  }

  /**
   * `getMaxSwappable` probe: build a `SwapOrder` from an estimate ALONE, so
   * `getMaxSpendable` can price the network fee before any real order, and its
   * deposit address, exists. The trimmed amount it computes is then run through
   * the real `fetchSwapQuoteInner`, which creates exactly one order.
   *
   * There is no `enforceMax` flag here because WizardSwap never reports a
   * maximum. A balance beyond its reserve comes back as the overloaded
   * "Insufficient liquidity." string, which carries no figure to clamp against,
   * so such a max swap surfaces as `SwapCurrencyError` and WizardSwap is simply
   * left out of the quote list.
   */
  const fetchProbeOrder = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromAddress } = await fetchEstimate(request)

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
      // reject with `SpendToSelfError` (every EVM chain, where the public key IS
      // the address). Without this flag that error escapes `getMaxSwappable` and
      // fails every max swap from an EVM wallet. The real order keeps all
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
      expirationDate: ensureInFuture(new Date(Date.now() + EXPIRATION_MS))
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
    const {
      fromChainCode,
      toChainCode,
      fromDenominatedAmount,
      fromAddress,
      toAddress
    } = await fetchEstimate(request)

    const orderJson = await fetchJson('exchange', {
      currency_from: fromChainCode,
      currency_to: toChainCode,
      amount_from: fromDenominatedAmount,
      address_to: toAddress,
      refund_address: fromAddress,
      ...(apiKey == null ? {} : { api_key: apiKey })
    })

    if (asMaybe(asWizardSwapFailedOrder)(orderJson) != null) {
      log.warn('WizardSwap rejected the order:', JSON.stringify(orderJson))
      throw new Error(
        `WizardSwap rejected this ${fromChainCode} to ${toChainCode} order. It reports no reason, but it answers this way when its own address rules refuse the payout address.`
      )
    }

    let order
    try {
      order = asWizardSwapOrder(orderJson)
    } catch (error: unknown) {
      log.warn('Unexpected WizardSwap API response:', JSON.stringify(orderJson))
      throw error
    }

    const fromNativeAmount = toNativeAmount(
      fromWallet,
      order.amount_from,
      request.fromTokenId
    )
    // The receive amount rounds DOWN, so the figure shown to the user is never
    // larger than what the provider actually sends.
    const payoutNativeAmount = toNativeAmount(
      toWallet,
      order.amount_to,
      request.toTokenId
    )

    // TRUST BOUNDARY. `fromNativeAmount` comes from the provider's response and
    // is about to become a SIGNED SPEND, so bound it by what the user actually
    // requested. Without this, a compromised or malformed response can move more
    // of the source asset than the quote asked for.
    //
    // Only a 'from' quote pins the source amount locally, and WizardSwap serves
    // nothing else, so this covers every order the plugin creates.
    if (
      request.quoteFor === 'from' &&
      gt(fromNativeAmount, request.nativeAmount)
    ) {
      throw new Error(
        'WizardSwap returned a source amount above the requested amount'
      )
    }

    const memos: EdgeMemo[] =
      order.extra_id_from == null
        ? []
        : [
            {
              type: memoType(fromWallet.currencyInfo.pluginId),
              value: order.extra_id_from
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: order.address_from
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
        orderId: order.id,
        orderUri: orderUri + order.id,
        // WizardSwap offers floating rates only, so the receive amount is never
        // guaranteed.
        isEstimate: true,
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
      expirationDate: ensureInFuture(new Date(Date.now() + EXPIRATION_MS))
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      // Reject blocked assets and same-asset (self) swaps CLIENT-SIDE, before
      // any provider endpoint is hit.
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
