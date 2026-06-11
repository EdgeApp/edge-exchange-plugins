import { gt, lt, round } from 'biggystring'
import {
  asArray,
  asBoolean,
  asDate,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
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

import { houdini as houdiniMapping } from '../../mappings/houdini'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  CurrencyPluginIdSwapChainCodeMap,
  denominationToNative,
  ensureInFuture,
  getContractAddresses,
  makeSwapPluginQuote,
  mapToRecord,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'houdini'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'HoudiniSwap',
  supportEmail: 'support@houdiniswap.com'
}

const asInitOptions = asObject({
  apiKey: asString,
  apiSecret: asString
})

const orderUri = 'https://houdiniswap.com/order/'
const uri = 'https://api-partner.houdiniswap.com/v2/'

/** Houdini only quotes off the input amount, so reverse quotes are unsupported. */
const SUPPORTED_QUOTE_FOR = 'from'

/** Houdini routes self-to-self privacy swaps via the `private` quote type. */
const QUOTE_TYPE = 'private'

/**
 * Edge plugins whose payout address must use a non-default address type. Zcash
 * partners settle to the transparent (`t1...`) address.
 */
const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  houdiniMapping
)

/** Normalize an EVM/contract address for case- and `0x`-insensitive comparison. */
const normalizeAddress = (address: string): string =>
  address.toLowerCase().replace(/^0x/, '')

export function makeHoudiniPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey, apiSecret } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `${apiKey}:${apiSecret}`
  }

  /**
   * Resolve an Edge asset to a Houdini token `id` (a Mongo ObjectId). The
   * `/quotes` endpoint rejects symbols, so every quote needs this lookup first.
   */
  async function getHoudiniTokenId(
    chain: string,
    currencyCode: string,
    contractAddress?: string
  ): Promise<string> {
    const query =
      contractAddress != null
        ? `tokens?chain=${chain}&address=${contractAddress}&hasCex=true&pageSize=20`
        : `tokens?chain=${chain}&symbol=${currencyCode}&hasCex=true&mainnet=true&pageSize=20`

    const response = await fetchCors(uri + query, { headers })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `Houdini token lookup returned error code ${response.status}, ${text}`
      )
    }
    const json = await response.json()
    const { tokens } = asTokenSearchResult(json)

    const normalizedContract =
      contractAddress != null ? normalizeAddress(contractAddress) : undefined

    const match = tokens.find(token => {
      if (token.enabled === false) return false
      if (token.chain !== chain) return false
      if (normalizedContract != null) {
        return (
          token.address != null &&
          normalizeAddress(token.address) === normalizedContract
        )
      }
      return (
        token.address == null &&
        token.symbol.toLowerCase() === currencyCode.toLowerCase()
      )
    })

    if (match == null) {
      throw new Error(
        `Houdini has no enabled token for ${currencyCode} on ${chain}`
      )
    }
    return match.id
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor, nativeAmount } = request

    // Houdini quotes are keyed off the input amount only.
    if (quoteFor !== SUPPORTED_QUOTE_FOR) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromPluginId = fromWallet.currencyInfo
      .pluginId as EdgeCurrencyPluginId
    const toPluginId = toWallet.currencyInfo.pluginId as EdgeCurrencyPluginId

    const fromChain = MAINNET_CODE_TRANSCRIPTION[fromPluginId]
    const toChain = MAINNET_CODE_TRANSCRIPTION[toPluginId]
    if (fromChain == null || toChain == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet, addressTypeMap[fromPluginId]),
      getAddress(toWallet, addressTypeMap[toPluginId])
    ])

    const { fromContractAddress, toContractAddress } = getContractAddresses(
      request
    )

    const [fromTokenId, toTokenId] = await Promise.all([
      getHoudiniTokenId(
        fromChain,
        request.fromCurrencyCode,
        fromContractAddress
      ),
      getHoudiniTokenId(toChain, request.toCurrencyCode, toContractAddress)
    ])

    const largeDenomAmount = nativeToDenomination(
      fromWallet,
      nativeAmount,
      request.fromTokenId
    )

    // Fetch quotes:
    const quoteResponse = await fetchCors(
      uri +
        `quotes?amount=${largeDenomAmount}&from=${fromTokenId}&to=${toTokenId}&types=${QUOTE_TYPE}&refundAddress=${fromAddress}`,
      { headers }
    )
    if (!quoteResponse.ok) {
      const text = await quoteResponse.text()
      throw new Error(
        `Houdini quote returned error code ${quoteResponse.status}, ${text}`
      )
    }
    const { quotes } = asQuoteResult(await quoteResponse.json())

    const validQuotes = quotes.filter(
      quote => quote.type === QUOTE_TYPE && quote.error == null
    )
    if (validQuotes.length === 0) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Prefer routes that actually accept the requested amount, then pick the
    // best payout among them. Only when NO route accepts the amount do we
    // surface a limit error, and it is computed across every route (the
    // smallest min / largest max) rather than off a single best route.
    const inRangeQuotes = validQuotes.filter(quote => {
      const aboveMin =
        quote.min == null || !lt(largeDenomAmount, String(quote.min))
      const belowMax =
        quote.max == null || !gt(largeDenomAmount, String(quote.max))
      return aboveMin && belowMax
    })

    if (inRangeQuotes.length === 0) {
      const mins = validQuotes
        .filter(quote => quote.min != null)
        .map(quote => String(quote.min))
      const maxes = validQuotes
        .filter(quote => quote.max != null)
        .map(quote => String(quote.max))
      const smallestMin =
        mins.length > 0 ? mins.reduce((a, b) => (lt(a, b) ? a : b)) : undefined
      const largestMax =
        maxes.length > 0
          ? maxes.reduce((a, b) => (gt(a, b) ? a : b))
          : undefined

      if (smallestMin != null && lt(largeDenomAmount, smallestMin)) {
        throw new SwapBelowLimitError(
          swapInfo,
          round(
            denominationToNative(fromWallet, smallestMin, request.fromTokenId),
            0
          )
        )
      }
      if (largestMax != null && gt(largeDenomAmount, largestMax)) {
        throw new SwapAboveLimitError(
          swapInfo,
          round(
            denominationToNative(fromWallet, largestMax, request.fromTokenId),
            0
          )
        )
      }
      throw new SwapCurrencyError(swapInfo, request)
    }

    const bestQuote = inRangeQuotes.reduce((best, quote) =>
      quote.amountOut > best.amountOut ? quote : best
    )

    // Create the exchange (this hands back the deposit address):
    const exchangeBody = {
      quoteId: bestQuote.quoteId,
      addressTo: toAddress,
      refundAddress: fromAddress
    }
    const exchangeResponse = await fetchCors(uri + 'exchanges', {
      method: 'POST',
      body: JSON.stringify(exchangeBody),
      headers
    })
    if (!exchangeResponse.ok) {
      const text = await exchangeResponse.text()
      throw new Error(
        `Houdini exchange returned error code ${exchangeResponse.status}, ${text}`
      )
    }
    const order = asHoudiniOrder(await exchangeResponse.json())

    // Houdini returns float amounts; round to whole atomic units.
    const toNativeAmount = round(
      denominationToNative(
        toWallet,
        String(order.outAmount),
        request.toTokenId
      ),
      0
    )

    const memos: EdgeMemo[] =
      order.depositTag == null
        ? []
        : [
            {
              type: memoType(fromPluginId),
              value: order.depositTag
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount,
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
        isEstimate: bestQuote.fixed !== true,
        toAsset: {
          pluginId: toPluginId,
          tokenId: request.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: fromPluginId,
          tokenId: request.fromTokenId,
          nativeAmount
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
      fromNativeAmount: nativeAmount,
      expirationDate:
        ensureInFuture(order.expires) ?? new Date(Date.now() + 1000 * 60)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      const swapOrder = await fetchSwapQuoteInner(request)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

const asHoudiniToken = asObject({
  id: asString,
  // `null` for mainnet assets; coerce to `undefined` so callers can `== null`.
  address: asMaybe(asString),
  chain: asString,
  symbol: asOptional(asString, ''),
  enabled: asOptional(asBoolean)
})

const asTokenSearchResult = asObject({
  tokens: asArray(asHoudiniToken)
})

const asHoudiniQuote = asObject({
  quoteId: asString,
  type: asString,
  amountIn: asNumber,
  amountOut: asNumber,
  min: asOptional(asNumber),
  max: asOptional(asNumber),
  fixed: asOptional(asBoolean),
  error: asOptional(asString)
})

const asQuoteResult = asObject({
  quotes: asArray(asHoudiniQuote)
})

const asHoudiniOrder = asObject({
  houdiniId: asString,
  depositAddress: asString,
  inAmount: asNumber,
  outAmount: asNumber,
  depositTag: asOptional(asString),
  expires: asOptional(asDate)
})
