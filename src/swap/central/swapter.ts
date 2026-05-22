import { lt } from 'biggystring'
import {
  asArray,
  asEither,
  asMaybe,
  asNull,
  asNumber,
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
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToRecord,
  nativeToDenomination,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'

const pluginId = 'swapter'
const orderUri = 'https://swapter.io/exchange-status/'
const apiBaseUrl = 'https://api.swapter.io'

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60

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

const asSwapterCreateResponse = asObject({
  uid: asString,
  deposit: asObject({
    address: asString,
    memo: asMaybe(asString),
    amount: asObject({
      expected: asNumber
    })
  }),
  withdraw: asObject({
    amount: asObject({
      expected: asNumber
    })
  })
})

const asSwapterMinAmountResponse = asObject({
  amount: asString
})

const asSwapterEstimateResponse = asObject({
  withdraw: asObject({
    amount: asNumber
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
    'X-API-KEY': `${initOptions.apiKey}`,
    Accept: 'application/json'
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const response = await fetchCors(apiBaseUrl + '/data/coins', { headers })

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
    } catch (e) {
      log.warn('Swapter: Error updating supported assets', e)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    swapType: SwapterSwapType
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor } = request

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
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const sourceAmount = nativeToDenomination(
      request.fromWallet,
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
      log.warn('Swapter min amount API error response:', text)
      throw new Error(
        `Swapter min amount returned error code ${minAmountResponse.status}`
      )
    }

    const minAmountJson = await minAmountResponse.json()
    const { amount: minAmount } = asSwapterMinAmountResponse(minAmountJson)

    if (lt(sourceAmount, minAmount)) {
      const minNativeAmount = denominationToNative(
        request.fromWallet,
        minAmount,
        request.fromTokenId
      )

      throw new SwapBelowLimitError(swapInfo, minNativeAmount)
    }

    log('Swapter create request:', {
      fromCurrencyCode: swapterCodes.fromCurrencyCode,
      fromNetwork: swapterCodes.fromMainnetCode,
      toCurrencyCode: swapterCodes.toCurrencyCode,
      toNetwork: swapterCodes.toMainnetCode,
      sourceAmount
    })

    const estimateResponse = await fetchCors(apiBaseUrl + '/v2/swap/estimate', {
      headers,
      method: 'POST',
      body: JSON.stringify({
        type: swapType,
        deposit: {
          coin: swapterCodes.fromCurrencyCode,
          network: swapterCodes.fromMainnetCode,
          amount: Number(sourceAmount)
        },
        withdraw: {
          coin: swapterCodes.toCurrencyCode,
          network: swapterCodes.toMainnetCode
        }
      })
    })

    if (!estimateResponse.ok) {
      const text = await estimateResponse.text()
      log.warn('Swapter estimate API error response:', text)
      throw new Error(
        `Swapter estimate returned error code ${estimateResponse.status}`
      )
    }

    const estimateJson = await estimateResponse.json()
    const estimateReply = asSwapterEstimateResponse(estimateJson)

    log('Swapter estimate response:', {
      toAmount: estimateReply.withdraw.amount
    })
    const response = await fetchCors(apiBaseUrl + '/v2/swap/create', {
      headers,
      method: 'POST',
      body: JSON.stringify({
        type: swapType,
        deposit: {
          coin: swapterCodes.fromCurrencyCode,
          network: swapterCodes.fromMainnetCode,
          amount: {
            expected: Number(sourceAmount)
          }
        },
        withdraw: {
          coin: swapterCodes.toCurrencyCode,
          network: swapterCodes.toMainnetCode,
          address: toAddress,
          memo: null
        },
        refund: {
          address: fromAddress,
          memo: null
        }
      })
    })

    if (!response.ok) {
      const text = await response.text()
      log.warn('Swapter API error response:', text)
      throw new Error(`Swapter returned error code ${response.status}`)
    }
    const responseJson = await response.json()
    log('Swapter create response:', JSON.stringify(responseJson, null, 2))

    let quoteReply
    try {
      quoteReply = asSwapterCreateResponse(responseJson)
    } catch (error) {
      log.warn('Unexpected Swapter API response:', JSON.stringify(responseJson))
      throw error
    }

    const fromNativeAmount = request.nativeAmount

    const toNativeAmount = denominationToNative(
      toWallet,
      quoteReply.withdraw.amount.expected.toString(),
      request.toTokenId
    )
    const memos: EdgeMemo[] =
      quoteReply.deposit.memo == null
        ? []
        : [
            {
              type: memoType(request.fromWallet.currencyInfo.pluginId),
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

    log('spendInfo', spendInfo)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: ensureInFuture(new Date(Date.now() + 30 * 60 * 1000))
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings?: Object
    ): Promise<EdgeSwapQuote> {
      const requestPlugin = convertRequest(request)
      const settings = asUserSettings(userSettings ?? {})
      const swapType: SwapterSwapType =
        settings.swapType === 'fixed' ? 'fixed' : 'float'
      await fetchSupportedAssets()

      checkInvalidTokenIds(INVALID_TOKEN_IDS, requestPlugin, swapInfo)

      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        requestPlugin,
        swapInfo
      )

      const swapOrder = await fetchSwapQuoteInner(requestPlugin, swapType)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}

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
