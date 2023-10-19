import { round, sub } from 'biggystring'
import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTxSwap,
  JsonObject,
  SwapCurrencyError
} from 'edge-core-js/types'
import { Client } from 'xrpl'

import { makeSwapPluginQuote, SwapOrder } from '../../util/swapHelpers'
import {
  convertRequest,
  fetchInfo,
  getAddress,
  promiseWithTimeout,
  shuffleArray
} from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'
import { getBuyQuote, getSellQuote } from './xrp/xrpDexHelpers'
import { MakeTxParams } from './xrp/xrpDexTypes'

const pluginId = 'xrpdex'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: true,
  displayName: 'XRP DEX',
  supportEmail: 'support@edge.app'
}

export const asInitOptions = asObject({
  appId: asOptional(asString, 'edge')
})

const EXPIRATION_MS = 1000 * 60
const DEX_MAX_FULLFILLMENT_TIME_S = 5 * 60 // 5 mins
const RIPPLE_SERVERS_DEFAULT = ['wss://s2.ripple.com']
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
const VOLATILITY_SPREAD_DEFAULT = 0.0075
const DUMMY_XRP_ADDRESS = 'rfuESo7eHUnvebxgaFjfYxfwXhM2uBPAj3'

export const asExchangeInfo = asObject({
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

export function makeXrpDexPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { appId } = asInitOptions(opts.initOptions)

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const {
      fromCurrencyCode,
      fromTokenId,
      toCurrencyCode,
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

    const fromIssuer =
      fromTokenId != null ? fromTokenId.split('-')[1] : undefined
    const toIssuer = toTokenId != null ? toTokenId.split('-')[1] : undefined
    const fromCurrency =
      fromTokenId != null ? fromTokenId.split('-')[0] : fromCurrencyCode
    const toCurrency =
      toTokenId != null ? toTokenId.split('-')[0] : toCurrencyCode

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

    const client = await getXrplConnectedClient(rippleServers)

    let quote: number
    let fromNativeAmount: string
    let toNativeAmount: string
    const taker = await getAddress(fromWallet)

    if (quoteFor === 'from') {
      fromNativeAmount = nativeAmount
      const exchangeAmount = await fromWallet.nativeToDenomination(
        nativeAmount,
        fromCurrencyCode
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
        { client, showLogs: false }
      )
      quote = quote * (1 - volatilitySpread)
      toNativeAmount = await toWallet.denominationToNative(
        String(quote),
        toCurrencyCode
      )
      toNativeAmount = round(toNativeAmount, 0)
    } else {
      toNativeAmount = nativeAmount
      const exchangeAmount = await toWallet.nativeToDenomination(
        nativeAmount,
        toCurrencyCode
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
        { client, showLogs: false }
      )
      quote = quote * (1 + volatilitySpread)
      fromNativeAmount = await fromWallet.denominationToNative(
        String(quote),
        fromCurrencyCode
      )
      fromNativeAmount = round(fromNativeAmount, 0)
    }

    const timestampNow = Date.now()
    const expiration = timestampNow / 1000 + DEX_MAX_FULLFILLMENT_TIME_S

    const swapData: EdgeTxSwap = {
      isEstimate: false,
      payoutAddress: toAddress,
      payoutCurrencyCode: toCurrencyCode,
      payoutNativeAmount: toNativeAmount,
      payoutWalletId: toWallet.id,
      plugin: { ...swapInfo }
    }

    const makeTxParams: MakeTxParams = {
      type: 'MakeTxDexSwap',
      metadata: {},
      swapData,
      fromTokenId,
      fromNativeAmount,
      toTokenId,
      toNativeAmount,
      expiration
    }

    await client.disconnect()

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

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: JsonObject | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      const { fromCurrencyCode, fromTokenId, fromWallet, quoteFor } = request

      let swapOrder: SwapOrder
      if (quoteFor === 'max') {
        request.quoteFor = 'from'
        request.nativeAmount = fromWallet.balances[fromCurrencyCode]
        swapOrder = await fetchSwapQuoteInner(request)
        if (fromTokenId == null) {
          // We can swap all mainnet coins minus the expected fee
          const quote = await makeSwapPluginQuote(swapOrder)
          const swapFee = quote.networkFee.nativeAmount

          // Get the balance of the wallet minus reserve
          const maxSpendable = await fromWallet.getMaxSpendable({
            currencyCode: fromCurrencyCode,
            spendTargets: [
              {
                publicAddress: DUMMY_XRP_ADDRESS
              }
            ]
          })
          request.nativeAmount = sub(maxSpendable, swapFee)
          return await this.fetchSwapQuote(request, userSettings, opts)
        }
      } else {
        swapOrder = await fetchSwapQuoteInner(request)
      }
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

const getXrplConnectedClient = async (servers: string[]): Promise<Client> => {
  let client
  let error
  if (servers.length === 0) {
    throw new Error('No ripple servers')
  }
  const shuffled = shuffleArray(servers)
  for (const server of shuffled) {
    client = new Client(server)
    try {
      await client.connect()
      return client
    } catch (e) {
      error = e
      // Harmless if one server fails
    }
  }
  throw error
}
