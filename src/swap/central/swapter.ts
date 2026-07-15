import { lt, round } from 'biggystring'
import {
  asArray,
  asEither,
  asJSON,
  asMaybe,
  asNull,
  asObject,
  asString,
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
const asUserSettings = asObject({
  swapType: asMaybe(asValue('float', 'fixed'))
})

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

const asSwapterMinAmountResponse = asObject({
  amount: asNumberString
})

const asSwapterErrorResponse = asJSON(
  asObject({
    error: asObject({
      // Swapter sends string codes today, but its amount fields are numbers, so
      // accept either rather than silently falling back to a generic error.
      code: asNumberString,
      message: asMaybe(asString)
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

type SwapterSwapType = 'float' | 'fixed'

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  swapterMapping
)

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
  const throwSwapterError = (
    stage: string,
    status: number,
    text: string,
    request: EdgeSwapRequestPlugin
  ): never => {
    const errorResponse = asMaybe(asSwapterErrorResponse)(text)
    if (
      errorResponse != null &&
      UNSUPPORTED_PAIR_CODES.includes(errorResponse.error.code)
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    log.warn(`Swapter ${stage} API error response:`, text)
    throw new Error(`Swapter ${stage} returned error code ${status}`)
  }

  /**
   * Shared quote setup: gate the direction, resolve Swapter's asset codes and
   * both addresses, and enforce the pair's minimum. Creates NO order, so both
   * the probe and the real quote can call it.
   */
  const fetchQuoteBase = async (
    request: EdgeSwapRequestPlugin
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
      MAINNET_CODE_TRANSCRIPTION
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

    const minAmountResponse = await fetchCors(
      apiBaseUrl + '/v2/swap/min-amount',
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

    if (!minAmountResponse.ok) {
      const text = await minAmountResponse.text()
      throwSwapterError('min amount', minAmountResponse.status, text, request)
    }

    const minAmountJson = await minAmountResponse.json()
    const { amount: minAmount } = asSwapterMinAmountResponse(minAmountJson)

    if (lt(sourceAmount, minAmount)) {
      // `denominationToNative` is a plain multiply, so a provider amount with
      // more decimals than the asset's denomination yields a fractional native
      // value. Native amounts must be integer atomic units.
      const minNativeAmount = round(
        denominationToNative(fromWallet, minAmount, request.fromTokenId),
        0
      )

      throw new SwapBelowLimitError(swapInfo, minNativeAmount)
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
    const { fromAddress } = await fetchQuoteBase(request)

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          publicAddress: fromAddress
        }
      ],
      networkFeeOption: 'high',
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
    swapType: SwapterSwapType
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet } = request
    const {
      swapterCodes,
      sourceAmount,
      fromAddress,
      toAddress
    } = await fetchQuoteBase(request)

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
      throwSwapterError('create', response.status, text, request)
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

    const toNativeAmount = round(
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
      const settings = asUserSettings(userSettings ?? {})
      const swapType: SwapterSwapType =
        settings.swapType === 'fixed' ? 'fixed' : 'float'

      await fetchSupportedAssets()

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(fetchProbeOrder, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest, swapType)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
