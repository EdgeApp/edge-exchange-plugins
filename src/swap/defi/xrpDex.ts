import { gt, round, sub } from 'biggystring'
import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'
import {
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTxActionSwap,
  InsufficientFundsError,
  JsonObject,
  SwapCurrencyError
} from 'edge-core-js/types'

import { PluginEnvironment } from '../../util/makeSwapPlugin'
import { makeSwapPluginQuote, SwapOrder } from '../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  fetchInfo,
  getAddress,
  nativeToDenomination,
  promiseWithTimeout
} from '../../util/utils'
import { EdgeSwapRequestPlugin, MakeTxParams } from '../types'
import { getBuyQuote, getSellQuote } from './xrp/xrpDexHelpers'
import { asXrpNetworkLocation } from './xrp/xrpDexTypes'

const asInitOptions = asObject({
  appId: asOptional(asString, 'edge')
})

const EXPIRATION_MS = 1000 * 60
const DEX_MAX_FULLFILLMENT_TIME_S = 5 * 60 // 5 mins
const RIPPLE_SERVERS_DEFAULT = [
  'wss://xrplcluster.com',
  'wss://s1.ripple.com',
  'wss://s2.ripple.com',
  'wss://xrpl.ws'
]
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
const VOLATILITY_SPREAD_DEFAULT = 0.0075
const DUMMY_XRP_ADDRESS = 'rfuESo7eHUnvebxgaFjfYxfwXhM2uBPAj3'

// This is a multiplier to enforce the maximum decimals used by the DEX.
// This does not necessarily correspond to the XRP denomination as tokens can have an
// arbitrary number of decimals since they are floats. But since the DEX errors with
// too many decimals (not sure how much), we for now cap swap amounts to 6 decimals
const MAX_DECIMALS_MULTIPLIER = 1000000

const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      xrpdex: asObject({
        volatilitySpread: asNumber,
        rippleServers: asOptional(asArray(asString))
      })
    })
  })
})

type ExchangeInfo = ReturnType<typeof asExchangeInfo>

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0

const fetchSwapQuoteInner = async (
  env: PluginEnvironment,
  request: EdgeSwapRequestPlugin
): Promise<SwapOrder> => {
  const { io, log, swapInfo } = env
  const { fetchCors = io.fetch } = io
  const { appId } = asInitOptions(env.initOptions)

  const {
    fromTokenId,
    toTokenId,
    nativeAmount,
    fromWallet,
    toWallet,
    quoteFor
  } = request

  // Only support ripple wallets
  if (
    fromWallet.currencyInfo.pluginId !== 'ripple' ||
    toWallet.currencyInfo.pluginId !== 'ripple'
  ) {
    throw new SwapCurrencyError(swapInfo, request)
  }

  // Source and dest wallet must be the same
  if (fromWallet.id !== toWallet.id) {
    throw new Error('XRP DEX must use same wallet for source and destination')
  }

  // Do not support transfer between same assets
  if (request.fromTokenId === request.toTokenId) {
    throw new SwapCurrencyError(swapInfo, request)
  }

  const rippleServers: string[] = RIPPLE_SERVERS_DEFAULT
  const volatilitySpread: number = VOLATILITY_SPREAD_DEFAULT

  let fromIssuer: string | undefined
  let fromCurrency: string = fromWallet.currencyInfo.currencyCode
  if (fromTokenId != null) {
    const fromToken = fromWallet.currencyConfig.allTokens[fromTokenId]
    const fromTokenNetworkLocation = asXrpNetworkLocation(
      fromToken.networkLocation
    )
    fromIssuer = fromTokenNetworkLocation.issuer
    fromCurrency = fromTokenNetworkLocation.currency
  }

  let toIssuer: string | undefined
  let toCurrency: string = toWallet.currencyInfo.currencyCode
  if (toTokenId != null) {
    const toToken = toWallet.currencyConfig.allTokens[toTokenId]
    const toTokenNetworkLocation = asXrpNetworkLocation(toToken.networkLocation)
    toIssuer = toTokenNetworkLocation.issuer
    toCurrency = toTokenNetworkLocation.currency
  }

  // Grab addresses:
  const toAddress = await getAddress(toWallet)

  const now = Date.now()
  if (
    now - exchangeInfoLastUpdate > EXCHANGE_INFO_UPDATE_FREQ_MS ||
    exchangeInfo == null
  ) {
    try {
      const exchangeInfoResponse = await promiseWithTimeout(
        fetchInfo(fetchCors, `v1/exchangeInfo/${appId}`)
      )

      if (exchangeInfoResponse.ok === true) {
        exchangeInfo = asExchangeInfo(await exchangeInfoResponse.json())
        exchangeInfoLastUpdate = now
      } else {
        // Error is ok. We just use defaults
        log('Error getting info server exchangeInfo. Using defaults...')
      }
    } catch (e: any) {
      log(
        'Error getting info server exchangeInfo. Using defaults...',
        e.message
      )
    }
  }

  // ----------------------------------------------------------------
  // Get a quote
  // ----------------------------------------------------------------

  let quote: number
  let fromNativeAmount: string
  let toNativeAmount: string
  const taker = await getAddress(fromWallet)

  if (quoteFor === 'from') {
    fromNativeAmount = nativeAmount
    const exchangeAmount = nativeToDenomination(
      fromWallet,
      nativeAmount,
      fromTokenId
    )

    quote = await getSellQuote(
      {
        weSell: {
          currency: fromCurrency,
          issuer: fromIssuer
        },
        weSellAmountOfTokens: Number(exchangeAmount),
        counterCurrency: {
          currency: toCurrency,
          issuer: toIssuer
        },
        taker
      },
      { rippleServers, showLogs: false }
    )
    quote = quote * (1 - volatilitySpread)
    quote =
      Math.round(quote * MAX_DECIMALS_MULTIPLIER) / MAX_DECIMALS_MULTIPLIER
    toNativeAmount = denominationToNative(toWallet, String(quote), toTokenId)
    toNativeAmount = round(toNativeAmount, 0)
  } else {
    toNativeAmount = nativeAmount
    const exchangeAmount = nativeToDenomination(
      toWallet,
      nativeAmount,
      toTokenId
    )

    quote = await getBuyQuote(
      {
        weWant: {
          currency: toCurrency,
          issuer: toIssuer
        },
        weWantAmountOfToken: Number(exchangeAmount),
        counterCurrency: {
          currency: fromCurrency,
          issuer: fromIssuer
        },
        taker
      },
      { rippleServers, showLogs: false }
    )
    quote = quote * (1 + volatilitySpread)
    quote =
      Math.round(quote * MAX_DECIMALS_MULTIPLIER) / MAX_DECIMALS_MULTIPLIER

    fromNativeAmount = denominationToNative(
      fromWallet,
      String(quote),
      fromTokenId
    )
    fromNativeAmount = round(fromNativeAmount, 0)
  }

  const timestampNow = Date.now()
  const expiration = timestampNow / 1000 + DEX_MAX_FULLFILLMENT_TIME_S

  const savedAction: EdgeTxActionSwap = {
    actionType: 'swap',
    swapInfo,
    isEstimate: false,
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
    payoutWalletId: toWallet.id
  }

  const makeTxParams: MakeTxParams = {
    type: 'MakeTxDexSwap',
    assetAction: { assetActionType: 'swap' },
    savedAction,
    fromTokenId,
    fromNativeAmount,
    toTokenId,
    toNativeAmount,
    expiration
  }

  return {
    canBePartial: true,
    maxFulfillmentSeconds: DEX_MAX_FULLFILLMENT_TIME_S,
    request,
    makeTxParams,
    swapInfo,
    fromNativeAmount,
    expirationDate: new Date(Date.now() + EXPIRATION_MS)
  }
}

export async function fetchSwapQuote(
  env: PluginEnvironment,
  req: EdgeSwapRequest,
  userSettings: JsonObject | undefined,
  opts: { promoCode?: string }
): Promise<EdgeSwapQuote> {
  const request = convertRequest(req)
  const { fromTokenId, fromWallet, quoteFor } = request

  // Get the balance of the wallet minus reserve
  const maxSpendable = await fromWallet.getMaxSpendable({
    tokenId: request.fromTokenId,
    spendTargets: [
      {
        publicAddress: DUMMY_XRP_ADDRESS
      }
    ]
  })

  let swapOrder: SwapOrder
  if (quoteFor === 'max') {
    request.quoteFor = 'from'
    request.nativeAmount = fromWallet.balanceMap.get(fromTokenId) ?? '0'
    swapOrder = await fetchSwapQuoteInner(env, request)
    if (fromTokenId == null) {
      // We can swap all mainnet coins minus the expected fee
      const quote = await makeSwapPluginQuote(swapOrder)
      const swapFee = quote.networkFee.nativeAmount

      request.nativeAmount = sub(maxSpendable, swapFee)
      return await fetchSwapQuote(env, request, userSettings, opts)
    }
  } else {
    swapOrder = await fetchSwapQuoteInner(env, request)
    if (gt(swapOrder.fromNativeAmount, maxSpendable)) {
      throw new InsufficientFundsError({
        tokenId: swapOrder.request.fromTokenId
      })
    }
  }
  return await makeSwapPluginQuote(swapOrder)
}
