import { ceil, floor, gt, lt, mul } from 'biggystring'
import {
  asArray,
  asBoolean,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown,
  asValue
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  JsonObject,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { mptrade as mptradeMapping } from '../../mappings/mptrade'
import {
  checkInvalidTokenIds,
  getMaxSwappable,
  makeSwapPluginQuote,
  mapToStringMap,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  getAddress,
  makeQueryParams,
  memoType
} from '../../util/utils'
import { createEvmApprovalEdgeTransactions } from '../defi/defiUtils'
import { asNumberString, EdgeSwapRequestPlugin, StringMap } from '../types'
import { asOptionalBlank } from './changenow'

/**
 * One MoonPay Trade API, two Edge registrations, split by VENUE because `isDex`
 * lives on the plugin rather than the quote:
 *
 * - `mptrade` (this file, CENTRALIZED): every route whose settlement a server
 *   can gate. EVM payloads carry a MoonPay Trade server signature the router
 *   requires, `alt-vm` sources pay an operator-issued deposit address, and
 *   every cross-chain route releases funds through a bridge whose escrow is
 *   operator-run for part of their set. That is what the Edge DEX litmus asks,
 *   not whether defi shows up in the implementation.
 * - `mptradedefi` (`defi/mptradeDefi.ts`, DEX): every route settled on a
 *   permissionless venue, which today is Solana-to-Solana. MoonPay Trade
 *   invokes the underlying program directly with no router of its own, no order
 *   state depends on user identity, and delivery happens inside the user's own
 *   atomic transaction, so no party can gate it after signing. The id is
 *   venue-generic, not chain-specific: the route set can grow.
 *
 * `handlesRoute` partitions every pair between the two, so a route is quoted
 * exactly once and never by both.
 *
 * Both registrations carry the MoonPay Trade brand, and their display names say
 * which venue each covers, since Swap Settings and the preferred-provider
 * picker show `displayName` alone.
 */
export interface MpTradeVariant {
  swapInfo: EdgeSwapInfo
  handlesRoute: (fromPluginId: string, toPluginId: string) => boolean
}

/** The one route family whose settlement is the user's own atomic transaction. */
export const isSolanaSameChainRoute = (
  fromPluginId: string,
  toPluginId: string
): boolean => fromPluginId === 'solana' && toPluginId === 'solana'

export const mpTradeSwapInfo: EdgeSwapInfo = {
  pluginId: 'mptrade',
  isDex: false,
  displayName: 'MoonPay Trade (Centralized)',
  supportEmail: 'support@edge.app'
}

const centralVariant: MpTradeVariant = {
  swapInfo: mpTradeSwapInfo,
  handlesRoute: (fromPluginId, toPluginId) =>
    !isSolanaSameChainRoute(fromPluginId, toPluginId)
}

const asInitOptions = asObject({
  apiKey: asString
})

const MPTRADE_API_URL = 'https://api-v2.swaps.xyz/api'
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'
// MoonPay Trade quotes are time-sensitive on-chain routes; keep them
// short-lived.
const EXPIRATION_MS = 1000 * 60
// Slippage tiers in basis points, per MoonPay Trade's own guidance: stables
// need no more than 10, major assets 50, and the long tail 100. The band is not
// a display nicety here. The quote publishes `amountOutMin`, which IS the
// amount Edge commits to, so a tighter band directly raises the number the user
// is guaranteed to receive.
const SLIPPAGE_BPS_STABLE = 10
const SLIPPAGE_BPS_MAJOR = 50
const SLIPPAGE_BPS_DEFAULT = 100

/**
 * Codes are chain-agnostic: USDC on Base and USDC on Arbitrum carry the same
 * price risk between quote and settlement, so they share a tier. Both sets are
 * a starting point the info server can retune per route popularity without an
 * app release (see `asMpTradeInfoPayload`).
 */
const STABLE_CURRENCY_CODES = new Set([
  'DAI',
  'FDUSD',
  'GUSD',
  'PYUSD',
  'TUSD',
  'USDC',
  'USDE',
  'USDP',
  'USDS',
  'USDT'
])
const MAJOR_CURRENCY_CODES = new Set([
  'AVAX',
  'BCH',
  'BNB',
  'BTC',
  'ETH',
  'LTC',
  'SOL',
  'TRX',
  'WBTC',
  'WETH',
  'XRP'
])
// MoonPay Trade explorer base for the saved swap action.
const ORDER_URI = 'https://explorer.swaps.xyz/tx/'
// Solana has no "zero address"; the system program stands in as the spend
// target's public address, matching how rango names a native SOL source. The
// engine ignores it and executes `otherParams.unsignedTx`.
const SOLANA_SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'

// Maps EdgeCurrencyPluginId -> MoonPay Trade numeric chainId (as a string).
const MAINNET_CODE_TRANSCRIPTION: StringMap = mapToStringMap(mptradeMapping)

/**
 * The shape of `getAction`'s `tx` depends on the SOURCE chain's `vmId`, so each
 * one gets its own cleaner and its own spend builder:
 *
 * - `evm`: router calldata. `data` is `'0x'` when the route is a plain value
 *   send to a bridge contract (every EVM -> alt-vm route observed).
 * - `solana`: an unsigned v0 `VersionedTransaction`, base64. `SolanaEngine`
 *   deserializes it out of `otherParams.unsignedTx`.
 * - `alt-vm`: a deposit address on the source chain, with `toExtra` carrying
 *   the memo/tag when that chain needs one.
 */
const asMpTradeEvmTx = asObject({
  to: asString,
  data: asString,
  value: asString,
  chainId: asNumber
})

const asMpTradeSolanaTx = asObject({
  base64Tx: asString,
  recentBlockhash: asString,
  payer: asString
})

const asMpTradeAltVmTx = asObject({
  to: asString,
  // A destination tag can arrive as a number (XRP tags are numeric), and the
  // valid tag `0` must survive: accept either shape, treat only null or blank
  // as absent.
  toExtra: asOptionalBlank(asNumberString),
  value: asString,
  chainId: asNumber
})

const asMpTradeAmount = asObject({
  amount: asString,
  address: asString,
  chainId: asNumber,
  isNative: asBoolean,
  decimals: asNumber,
  symbol: asString
})

/**
 * Everything outside `tx`, which is identical across route models. `tx` stays
 * `unknown` here and is cleaned by the branch that knows its `vmId`.
 */
const asMpTradeAction = asObject({
  tx: asUnknown,
  txId: asString,
  amountIn: asMpTradeAmount,
  amountOut: asMpTradeAmount,
  amountOutMin: asMpTradeAmount,
  vmId: asString,
  requiresTokenApproval: asBoolean,
  // Registration is how MoonPay Trade starts tracking an order it did not
  // itself broadcast. The partner requires it on every route that sets this
  // flag, EVM included: an unregistered order sits pending in their tracking.
  requiresRegisterTransaction: asOptional(asBoolean, false),
  executionsType: asString
})

/**
 * `getPaths` amount limits. Both fields are DECIMAL strings on the SOURCE
 * token, NOT the base units a request's `nativeAmount` uses, so they have to be
 * scaled by `srcToken.decimals` before any comparison. The MoonPay Trade API
 * reference calls them base units; the live API disagrees, and a 6.4 ETH
 * ceiling read as 6.4 wei rejects every real quote. Both are `null` whenever
 * the route carries no limit.
 */
const asMpTradeAmountLimits = asObject({
  minAmount: asOptional(asString),
  maxAmount: asOptional(asString)
})

const asMpTradePath = asObject({
  chainId: asNumber,
  supportsExactAmountIn: asOptional(asBoolean, true),
  amountLimits: asOptional(asMpTradeAmountLimits)
})

/** The source token's own limits, plus the decimals that scale them. */
const asMpTradeSrcToken = asObject({
  decimals: asNumber,
  minAmount: asOptional(asString),
  maxAmount: asOptional(asString)
})

const asMpTradePaths = asObject({
  srcToken: asMpTradeSrcToken,
  paths: asArray(asMpTradePath)
})

const asMpTradeError = asObject({
  success: asValue(false),
  error: asObject({
    code: asString,
    name: asOptional(asString, ''),
    message: asOptional(asString, ''),
    statusCode: asOptional(asNumber)
  })
})

const asMpTradeRegisterResults = asArray(
  asObject({
    success: asBoolean,
    error: asOptional(asString)
  })
)

/**
 * Runtime configuration from the info server, keyed per registration under
 * `corePlugins.<pluginId>`. Every field is optional and the whole payload is read
 * through `asMaybe`, so a malformed or absent payload silently falls back to the
 * built-in tiers rather than failing a quote.
 */
const asMpTradeInfoPayload = asObject({
  slippageBps: asOptional(
    asObject({
      stable: asOptional(asNumber),
      major: asOptional(asNumber),
      default: asOptional(asNumber)
    })
  )
})

interface SlippageTiers {
  stable: number
  major: number
  default: number
}

export const resolveSlippageTiers = (
  infoPayload: JsonObject
): SlippageTiers => {
  const payload = asMaybe(asMpTradeInfoPayload)(infoPayload)
  const slippageBps = payload?.slippageBps
  return {
    stable: slippageBps?.stable ?? SLIPPAGE_BPS_STABLE,
    major: slippageBps?.major ?? SLIPPAGE_BPS_MAJOR,
    default: slippageBps?.default ?? SLIPPAGE_BPS_DEFAULT
  }
}

const currencyTierBps = (
  currencyCode: string,
  tiers: SlippageTiers
): number => {
  const code = currencyCode.toUpperCase()
  if (STABLE_CURRENCY_CODES.has(code)) return tiers.stable
  if (MAJOR_CURRENCY_CODES.has(code)) return tiers.major
  return tiers.default
}

/**
 * A route is only as tight as its looser leg: a stablecoin paid out in a long
 * tail asset carries the long tail's price risk, so the wider band wins.
 */
export const resolveSlippageBps = (
  request: Pick<EdgeSwapRequestPlugin, 'fromCurrencyCode' | 'toCurrencyCode'>,
  tiers: SlippageTiers
): number =>
  Math.max(
    currencyTierBps(request.fromCurrencyCode, tiers),
    currencyTierBps(request.toCurrencyCode, tiers)
  )

export type MpTradeAction = ReturnType<typeof asMpTradeAction>
type MpTradeError = ReturnType<typeof asMpTradeError>

/**
 * The quote order plus the raw action it came from, so the plugin can decide
 * after broadcast whether the route needs `registerTxs`.
 */
type MpTradeSwapOrder = SwapOrder & { action: MpTradeAction }

/** Source-chain VMs this plugin knows how to execute. */
const SUPPORTED_VM_IDS = ['evm', 'solana', 'alt-vm']

/**
 * Context resolved from the swap request, passed to the pure spend-info
 * builder so it can be unit tested without a wallet or network.
 */
export interface MpTradeSpendContext {
  action: MpTradeAction
  /** The registration that quoted the route; recorded on the saved action. */
  swapInfo: EdgeSwapInfo
  fromPluginId: string
  toPluginId: string
  fromTokenId: string | null
  toTokenId: string | null
  fromAddress: string
  toAddress: string
  toWalletId: string
}

/**
 * Turn a parsed MoonPay Trade `getAction` response into the `EdgeSpendInfo`
 * that executes the swap, choosing the execution model from the SOURCE chain's
 * `vmId`:
 *
 * - `evm`: send `tx.data` calldata to the router at `tx.to`. A native source
 *   funds the router with `tx.value`; an ERC20 source must first approve
 *   `tx.to` (see the plugin's `fetchSwapQuoteInner`).
 * - `solana`: hand the engine the unsigned transaction; the spend target is
 *   descriptive only.
 * - `alt-vm`: pay `tx.value` to the deposit address at `tx.to`, carrying
 *   `tx.toExtra` as the chain's memo when the route supplies one.
 *
 * Pure and synchronous for testability.
 */
export const makeMpTradeSpendInfo = (
  context: MpTradeSpendContext
): EdgeSpendInfo => {
  const {
    action,
    swapInfo,
    fromPluginId,
    toPluginId,
    fromTokenId,
    toTokenId,
    fromAddress,
    toAddress,
    toWalletId
  } = context
  const { txId, amountIn, amountOutMin, vmId } = action

  let fromNativeAmount: string
  let publicAddress: string
  let memos: EdgeMemo[] = []
  let otherParams: EdgeSpendInfo['otherParams']

  switch (vmId) {
    case 'solana': {
      const tx = asMpTradeSolanaTx(action.tx)
      fromNativeAmount = amountIn.amount
      // The engine executes `unsignedTx`; this address only labels the spend.
      publicAddress = amountIn.isNative
        ? SOLANA_SYSTEM_PROGRAM_ID
        : amountIn.address
      otherParams = { unsignedTx: tx.base64Tx }
      break
    }
    case 'alt-vm': {
      const tx = asMpTradeAltVmTx(action.tx)
      fromNativeAmount = tx.value
      publicAddress = tx.to
      if (tx.toExtra != null && tx.toExtra !== '') {
        memos = [{ type: memoType(fromPluginId), value: tx.toExtra }]
      }
      break
    }
    default: {
      const tx = asMpTradeEvmTx(action.tx)
      // For a native source the wallet must send `tx.value`; for a token source
      // the router pulls the approved amount and the tx itself carries no value.
      fromNativeAmount = fromTokenId == null ? tx.value : amountIn.amount
      publicAddress = tx.to
      // An EVM route into a non-EVM destination is a plain value send to the
      // bridge contract and carries no calldata; an empty hex memo would make
      // the engine build a data field of `0x` for no reason.
      const data = tx.data.replace(/^0x/, '')
      if (data !== '') memos = [{ type: 'hex', value: data }]
      break
    }
  }

  const spendInfo: EdgeSpendInfo = {
    tokenId: fromTokenId,
    spendTargets: [
      {
        nativeAmount: fromNativeAmount,
        publicAddress
      }
    ],
    memos,
    ...(otherParams == null ? {} : { otherParams }),
    networkFeeOption: 'high',
    assetAction: {
      assetActionType: 'swap'
    },
    savedAction: {
      actionType: 'swap',
      swapInfo,
      orderId: txId,
      orderUri: ORDER_URI + txId,
      // MoonPay Trade commits to `amountOutMin`: the route's on-chain floor,
      // which the user receives or the swap does not settle. Quoting that floor
      // rather than the expected `amountOut` is what makes this a FIXED quote,
      // on MoonPay Trade's own recommendation. The user may receive more; they
      // can never receive less, which is exactly what a fixed quote promises.
      isEstimate: false,
      toAsset: {
        pluginId: toPluginId,
        tokenId: toTokenId,
        nativeAmount: amountOutMin.amount
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
  'NO_QUOTE',
  // MoonPay Trade rejects address formats it cannot pay: Zcash routes take only
  // `t3…` P2SH addresses, so every `t1…` and every unified `u1…` Edge hands
  // them comes back as INVALID_ADDRESS_FORMAT. From the user's side that is
  // the provider being unable to serve the pair, which is what the core ranks
  // a currency error as, rather than an internal fault worth surfacing.
  'ADDRESS'
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

/**
 * Scale a decimal `getPaths` limit into the source token's base units, which is
 * what every amount on an `EdgeSwapRequest` is expressed in. A token with few
 * decimals can leave a fractional residue, so a floor limit rounds UP and a
 * ceiling limit rounds DOWN — neither may widen the range the route allows.
 */
const limitToNative = (
  limit: string,
  decimals: number,
  roundUp: boolean
): string => {
  const scaled = mul(limit, `1${'0'.repeat(decimals)}`)
  return roundUp ? ceil(scaled, 0) : floor(scaled, 0)
}

/** Translate a MoonPay Trade error response into the closest Edge swap error. */
const throwMpTradeError = (
  swapInfo: EdgeSwapInfo,
  swapError: MpTradeError,
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
    `MoonPay Trade ${endpoint} failed: ${code}${
      message !== '' ? ` (${message})` : ''
    }`
  )
}

export function makeMpTradeBasedPlugin(
  opts: EdgeCorePluginOptions,
  variant: MpTradeVariant
): EdgeSwapPlugin {
  const { io, log } = opts
  const { swapInfo, handlesRoute } = variant
  const { apiKey } = asInitOptions(opts.initOptions)
  const { fetchCors = io.fetch } = io

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  }

  /**
   * POST the broadcast hash back to MoonPay Trade so they start tracking the
   * order. Required on every route that flags it, EVM included: it attaches the
   * hash to their order for status tracking, and an unregistered order sits
   * pending. The swap is already on chain by the time this runs, so a failure
   * here is logged and swallowed: throwing would report a successful swap as
   * failed.
   */
  const registerTx = async (txId: string, txHash: string): Promise<void> => {
    try {
      const response = await fetchCors(`${MPTRADE_API_URL}/registerTxs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ txId, txHash })
      })
      const json = await response.json()
      const results = asMaybe(asMpTradeRegisterResults)(json)
      const failure = results?.find(result => !result.success)
      if (!response.ok || failure != null) {
        log.warn(
          `MoonPay Trade registerTxs failed for ${txId}: ${
            failure?.error ?? `status ${response.status}`
          }`
        )
      }
    } catch (error: unknown) {
      log.warn(`MoonPay Trade registerTxs threw for ${txId}: ${String(error)}`)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    slippageBps: number,
    isMaxRequest: boolean = false
  ): Promise<MpTradeSwapOrder> => {
    const {
      fromTokenId,
      toTokenId,
      nativeAmount,
      fromWallet,
      toWallet,
      quoteFor
    } = request

    // MoonPay Trade `getAction` builds a route for an exact source amount.
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromPluginId = fromWallet.currencyInfo.pluginId
    const toPluginId = toWallet.currencyInfo.pluginId

    // The other registration owns this pair; to the core that reads as this
    // provider not serving it, which is exactly the ranking wanted.
    if (!handlesRoute(fromPluginId, toPluginId)) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Rejects same-asset transfers plus the shared default exclusions every
    // central plugin applies. MoonPay Trade adds none of its own, so the map is
    // empty, matching nym.
    checkInvalidTokenIds({ from: {}, to: {} }, request, swapInfo)

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
      `${MPTRADE_API_URL}/getPaths?${pathsParams}`,
      { headers }
    )
    const pathsJson = await pathsResponse.json()

    const pathsError = asMaybe(asMpTradeError)(pathsJson)
    if (pathsError != null) {
      throwMpTradeError(swapInfo, pathsError, request, 'getPaths')
    }
    if (!pathsResponse.ok) {
      throw new Error(
        `MoonPay Trade getPaths failed with status ${pathsResponse.status}`
      )
    }

    const { srcToken, paths } = asMpTradePaths(pathsJson)
    // An unsupported chain or token pair comes back as HTTP 200 with an empty
    // `paths` array, not as an error body.
    const path = paths.find(entry => entry.chainId === Number(toChainId))
    if (path == null || !path.supportsExactAmountIn) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Route limits win over the source token's own limits when both exist.
    // Both arrive as decimal strings, so they have to be scaled into the base
    // units `nativeAmount` uses before any compare.
    const { decimals } = srcToken
    const minLimit = path.amountLimits?.minAmount ?? srcToken.minAmount
    const maxLimit = path.amountLimits?.maxAmount ?? srcToken.maxAmount
    const minAmount =
      minLimit == null ? null : limitToNative(minLimit, decimals, true)
    const maxAmount =
      maxLimit == null ? null : limitToNative(maxLimit, decimals, false)
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
      slippage: String(slippageBps)
    })

    const response = await fetchCors(`${MPTRADE_API_URL}/getAction?${params}`, {
      headers
    })
    const responseJson = await response.json()

    const swapError = asMaybe(asMpTradeError)(responseJson)
    if (swapError != null) {
      throwMpTradeError(swapInfo, swapError, request, 'getAction')
    }
    if (!response.ok) {
      throw new Error(
        `MoonPay Trade getAction failed with status ${response.status}`
      )
    }

    const action = asMpTradeAction(responseJson)

    // Every route model this plugin executes is driven off the SOURCE chain's
    // `vmId`. `hypercore` has no Edge currency plugin, and a non-DEFAULT
    // execution type (gasless and friends) needs machinery we do not have.
    if (!SUPPORTED_VM_IDS.includes(action.vmId)) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    if (action.executionsType !== 'DEFAULT') {
      throw new SwapCurrencyError(swapInfo, request)
    }
    // A zero output means the amount is below the route's usable minimum.
    if (action.amountOut.amount === '0' || action.amountOutMin.amount === '0') {
      throw new SwapBelowLimitError(swapInfo, undefined, 'from')
    }
    // The spend below is built from response fields, so never let the response
    // authorize MORE of the source asset than was asked for. `amountIn` is
    // always in the SOURCE asset's units, so it always compares; the field the
    // spend actually SPENDS differs per route model and is checked with it.
    const rejectOverRequest = (amount: string): void => {
      if (gt(amount, swapAmount)) {
        throw new Error(
          'MoonPay Trade getAction returned a source amount above the requested amount'
        )
      }
    }
    rejectOverRequest(action.amountIn.amount)

    // ERC20 sources must approve the router (`tx.to`) before the swap. Only an
    // EVM route has a router to approve; the other models pay an address.
    const preTxs: EdgeTransaction[] = []
    if (action.vmId === 'alt-vm') {
      // The deposit spend sends `tx.value`, so it is the amount to bound.
      rejectOverRequest(asMpTradeAltVmTx(action.tx).value)
    }
    if (action.vmId === 'evm') {
      const evmTx = asMpTradeEvmTx(action.tx)
      // `tx.value` is native wei, comparable only when the source IS the native
      // asset. On a token route it is a protocol fee in a different unit, so
      // comparing it there would reject valid quotes.
      if (fromTokenId == null) rejectOverRequest(evmTx.value)
      if (fromTokenId != null && action.requiresTokenApproval) {
        const approvalTxs = await createEvmApprovalEdgeTransactions({
          request,
          approvalAmount: action.amountIn.amount,
          tokenContractAddress: fromTokenAddress,
          recipientAddress: evmTx.to,
          networkFeeOption: 'high'
        })
        preTxs.push(...approvalTxs)
      }
    }

    const spendInfo = makeMpTradeSpendInfo({
      action,
      swapInfo,
      fromPluginId,
      toPluginId,
      fromTokenId,
      toTokenId,
      fromAddress,
      toAddress,
      toWalletId: toWallet.id
    })

    return {
      action,
      expirationDate: new Date(Date.now() + EXPIRATION_MS),
      fromNativeAmount: swapAmount,
      preTxs,
      request,
      spendInfo,
      swapInfo
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: JsonObject | undefined,
      opts: { infoPayload: JsonObject }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      const slippageBps = resolveSlippageBps(
        request,
        resolveSlippageTiers(opts.infoPayload)
      )

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
            async r => await fetchSwapQuoteInner(r, slippageBps, true),
            request
          )
        }
      }
      const swapOrder = await fetchSwapQuoteInner(
        newRequest,
        slippageBps,
        isMaxRequest
      )
      const quote = await makeSwapPluginQuote(swapOrder)
      const { action } = swapOrder
      if (!action.requiresRegisterTransaction) return quote

      // `makeSwapPluginQuote` has no post-broadcast hook, so registration wraps
      // the quote it returns. The hash only exists once the wallet broadcasts.
      return {
        ...quote,
        async approve(opts) {
          const result = await quote.approve(opts)
          await registerTx(action.txId, result.transaction.txid)
          return result
        }
      }
    }
  }
  return out
}

export const makeMpTradePlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => makeMpTradeBasedPlugin(opts, centralVariant)
