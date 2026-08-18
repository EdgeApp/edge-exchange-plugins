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
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { swapsxyz as swapsxyzMapping } from '../../mappings/swapsxyz'
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
import { EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'swapsxyz'
// CENTRALIZED, despite the on-chain execution: every executable payload is
// signed by a swaps.xyz server (their fee module), and their `alt-vm` bridges
// have raised KYC flags, so the venue is server-gated. That is what the Edge
// DEX litmus asks, not whether defi shows up in the implementation.
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'swaps.xyz',
  supportEmail: 'support@edge.app'
}

const asInitOptions = asObject({
  apiKey: asString
})

const SWAPSXYZ_API_URL = 'https://api-v2.swaps.xyz/api'
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'
// swaps.xyz quotes are time-sensitive on-chain routes; keep them short-lived.
const EXPIRATION_MS = 1000 * 60
// 1% (100 basis points) default slippage.
const SLIPPAGE_BPS = '100'
// swaps.xyz explorer base for the saved swap action.
const ORDER_URI = 'https://explorer.swaps.xyz/tx/'
// Solana has no "zero address"; the system program stands in as the spend
// target's public address, matching how rango names a native SOL source. The
// engine ignores it and executes `otherParams.unsignedTx`.
const SOLANA_SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'

// Maps EdgeCurrencyPluginId -> swaps.xyz numeric chainId (as a string).
const MAINNET_CODE_TRANSCRIPTION: StringMap = mapToStringMap(swapsxyzMapping)

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
const asSwapsXyzEvmTx = asObject({
  to: asString,
  data: asString,
  value: asString,
  chainId: asNumber
})

const asSwapsXyzSolanaTx = asObject({
  base64Tx: asString,
  recentBlockhash: asString,
  payer: asString
})

const asSwapsXyzAltVmTx = asObject({
  to: asString,
  toExtra: asOptional(asString),
  value: asString,
  chainId: asNumber
})

const asSwapsXyzAmount = asObject({
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
const asSwapsXyzAction = asObject({
  tx: asUnknown,
  txId: asString,
  amountIn: asSwapsXyzAmount,
  amountOut: asSwapsXyzAmount,
  amountOutMin: asSwapsXyzAmount,
  vmId: asString,
  requiresTokenApproval: asBoolean,
  // Registration is how swaps.xyz starts tracking an order it did not itself
  // broadcast. Their docs call it mandatory for non-EVM transactions.
  requiresRegisterTransaction: asOptional(asBoolean, false),
  executionsType: asString
})

/**
 * `getPaths` amount limits. Both fields are DECIMAL strings on the SOURCE
 * token, NOT the base units a request's `nativeAmount` uses, so they have to be
 * scaled by `srcToken.decimals` before any comparison. The swaps.xyz API
 * reference calls them base units; the live API disagrees, and a 6.4 ETH
 * ceiling read as 6.4 wei rejects every real quote. Both are `null` whenever
 * the route carries no limit.
 */
const asSwapsXyzAmountLimits = asObject({
  minAmount: asOptional(asString),
  maxAmount: asOptional(asString)
})

const asSwapsXyzPath = asObject({
  chainId: asNumber,
  supportsExactAmountIn: asOptional(asBoolean, true),
  amountLimits: asOptional(asSwapsXyzAmountLimits)
})

/** The source token's own limits, plus the decimals that scale them. */
const asSwapsXyzSrcToken = asObject({
  decimals: asNumber,
  minAmount: asOptional(asString),
  maxAmount: asOptional(asString)
})

const asSwapsXyzPaths = asObject({
  srcToken: asSwapsXyzSrcToken,
  paths: asArray(asSwapsXyzPath)
})

const asSwapsXyzError = asObject({
  success: asValue(false),
  error: asObject({
    code: asString,
    name: asOptional(asString, ''),
    message: asOptional(asString, ''),
    statusCode: asOptional(asNumber)
  })
})

const asSwapsXyzRegisterResults = asArray(
  asObject({
    success: asBoolean,
    error: asOptional(asString)
  })
)

export type SwapsXyzAction = ReturnType<typeof asSwapsXyzAction>
type SwapsXyzError = ReturnType<typeof asSwapsXyzError>

/**
 * The quote order plus the raw action it came from, so the plugin can decide
 * after broadcast whether the route needs `registerTxs`.
 */
type SwapsXyzSwapOrder = SwapOrder & { action: SwapsXyzAction }

/** Source-chain VMs this plugin knows how to execute. */
const SUPPORTED_VM_IDS = ['evm', 'solana', 'alt-vm']

/**
 * Context resolved from the swap request, passed to the pure spend-info
 * builder so it can be unit tested without a wallet or network.
 */
export interface SwapsXyzSpendContext {
  action: SwapsXyzAction
  fromPluginId: string
  toPluginId: string
  fromTokenId: string | null
  toTokenId: string | null
  fromAddress: string
  toAddress: string
  toWalletId: string
}

/**
 * Turn a parsed swaps.xyz `getAction` response into the `EdgeSpendInfo` that
 * executes the swap, choosing the execution model from the SOURCE chain's
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
export const makeSwapsXyzSpendInfo = (
  context: SwapsXyzSpendContext
): EdgeSpendInfo => {
  const {
    action,
    fromPluginId,
    toPluginId,
    fromTokenId,
    toTokenId,
    fromAddress,
    toAddress,
    toWalletId
  } = context
  const { txId, amountIn, amountOut, vmId } = action

  let fromNativeAmount: string
  let publicAddress: string
  let memos: EdgeMemo[] = []
  let otherParams: EdgeSpendInfo['otherParams']

  switch (vmId) {
    case 'solana': {
      const tx = asSwapsXyzSolanaTx(action.tx)
      fromNativeAmount = amountIn.amount
      // The engine executes `unsignedTx`; this address only labels the spend.
      publicAddress = amountIn.isNative
        ? SOLANA_SYSTEM_PROGRAM_ID
        : amountIn.address
      otherParams = { unsignedTx: tx.base64Tx }
      break
    }
    case 'alt-vm': {
      const tx = asSwapsXyzAltVmTx(action.tx)
      fromNativeAmount = tx.value
      publicAddress = tx.to
      if (tx.toExtra != null && tx.toExtra !== '') {
        memos = [{ type: memoType(fromPluginId), value: tx.toExtra }]
      }
      break
    }
    default: {
      const tx = asSwapsXyzEvmTx(action.tx)
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
      isEstimate: true,
      toAsset: {
        pluginId: toPluginId,
        tokenId: toTokenId,
        nativeAmount: amountOut.amount
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
  // swaps.xyz rejects address formats it cannot pay: Zcash routes take only
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

/** Translate a swaps.xyz error response into the closest Edge swap error. */
const throwSwapsXyzError = (
  swapError: SwapsXyzError,
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
    `swaps.xyz ${endpoint} failed: ${code}${
      message !== '' ? ` (${message})` : ''
    }`
  )
}

export function makeSwapsXyzPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { apiKey } = asInitOptions(opts.initOptions)
  const { fetchCors = io.fetch } = io

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  }

  /**
   * POST the broadcast hash back to swaps.xyz so they start tracking the order.
   * Mandatory for the models where the wallet, not swaps.xyz, broadcasts. The
   * swap is already on chain by the time this runs, so a failure here is
   * logged and swallowed: throwing would report a successful swap as failed.
   */
  const registerTx = async (txId: string, txHash: string): Promise<void> => {
    try {
      const response = await fetchCors(`${SWAPSXYZ_API_URL}/registerTxs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ txId, txHash })
      })
      const json = await response.json()
      const results = asMaybe(asSwapsXyzRegisterResults)(json)
      const failure = results?.find(result => !result.success)
      if (!response.ok || failure != null) {
        log.warn(
          `swaps.xyz registerTxs failed for ${txId}: ${
            failure?.error ?? `status ${response.status}`
          }`
        )
      }
    } catch (error: unknown) {
      log.warn(`swaps.xyz registerTxs threw for ${txId}: ${String(error)}`)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    isMaxRequest: boolean = false
  ): Promise<SwapsXyzSwapOrder> => {
    const {
      fromTokenId,
      toTokenId,
      nativeAmount,
      fromWallet,
      toWallet,
      quoteFor
    } = request

    // swaps.xyz `getAction` builds a route for an exact source amount.
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromPluginId = fromWallet.currencyInfo.pluginId
    const toPluginId = toWallet.currencyInfo.pluginId

    // Rejects same-asset transfers plus the shared default exclusions every
    // central plugin applies. swaps.xyz adds none of its own, so the map is
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
      `${SWAPSXYZ_API_URL}/getPaths?${pathsParams}`,
      { headers }
    )
    const pathsJson = await pathsResponse.json()

    const pathsError = asMaybe(asSwapsXyzError)(pathsJson)
    if (pathsError != null) {
      throwSwapsXyzError(pathsError, request, 'getPaths')
    }
    if (!pathsResponse.ok) {
      throw new Error(
        `swaps.xyz getPaths failed with status ${pathsResponse.status}`
      )
    }

    const { srcToken, paths } = asSwapsXyzPaths(pathsJson)
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
      slippage: SLIPPAGE_BPS
    })

    const response = await fetchCors(
      `${SWAPSXYZ_API_URL}/getAction?${params}`,
      {
        headers
      }
    )
    const responseJson = await response.json()

    const swapError = asMaybe(asSwapsXyzError)(responseJson)
    if (swapError != null) {
      throwSwapsXyzError(swapError, request, 'getAction')
    }
    if (!response.ok) {
      throw new Error(
        `swaps.xyz getAction failed with status ${response.status}`
      )
    }

    const action = asSwapsXyzAction(responseJson)

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
          'swaps.xyz getAction returned a source amount above the requested amount'
        )
      }
    }
    rejectOverRequest(action.amountIn.amount)

    // ERC20 sources must approve the router (`tx.to`) before the swap. Only an
    // EVM route has a router to approve; the other models pay an address.
    const preTxs: EdgeTransaction[] = []
    if (action.vmId === 'alt-vm') {
      // The deposit spend sends `tx.value`, so it is the amount to bound.
      rejectOverRequest(asSwapsXyzAltVmTx(action.tx).value)
    }
    if (action.vmId === 'evm') {
      const evmTx = asSwapsXyzEvmTx(action.tx)
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

    const spendInfo = makeSwapsXyzSpendInfo({
      action,
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
      minReceiveAmount: action.amountOutMin.amount,
      preTxs,
      request,
      spendInfo,
      swapInfo
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

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
            async r => await fetchSwapQuoteInner(r, true),
            request
          )
        }
      }
      const swapOrder = await fetchSwapQuoteInner(newRequest, isMaxRequest)
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
