import { gt, lt } from 'biggystring'
import {
  asEither,
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
  EdgeFetchResponse,
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

import { exolix as exolixMapping } from '../../mappings/exolix'
import { EdgeCurrencyPluginId } from '../../util/edgeCurrencyPluginIds'
import {
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  getContractAddresses,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToRecord,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  getAddress,
  memoType,
  nativeToDenomination
} from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'exolix'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Exolix',
  supportEmail: 'support@exolix.com'
}

const asInitOptions = asObject({
  apiKey: asString
})

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {
    polygon: [
      '3c499c542cef5e3811e1192ce70d8cc03d5c3359' /* USDC */,
      '2791bca1f2de4661ed88a30c99a7a9449aa84174' /* USDC.e */
    ]
  },
  to: {
    polygon: [
      '3c499c542cef5e3811e1192ce70d8cc03d5c3359' /* USDC */,
      '2791bca1f2de4661ed88a30c99a7a9449aa84174' /* USDC.e */
    ]
  }
}

interface ExolixCommonQuoteParams {
  networkFrom: string
  networkTo: string
  coinAddressFrom?: string
  coinAddressTo?: string
  networkFromChainId?: number
  networkToChainId?: number
  withdrawalAddress: string
  withdrawalExtraId: string
  refundAddress: string
  refundExtraId: string
  rateType: 'fixed' | 'float'
  rateId?: string
}

type ExolixFromQuoteParams = ExolixCommonQuoteParams & {
  amount: string
}

type ExolixToQuoteParams = ExolixCommonQuoteParams & {
  withdrawalAmount: string
}

type ExolixQuoteParams = ExolixFromQuoteParams | ExolixToQuoteParams

const addressTypeMap: StringMap = {
  digibyte: 'publicAddress',
  zcash: 'transparentAddress'
}

// See https://exolix.com/currencies for list of supported currencies
// Or `curl -X GET "https://exolix.com/api/v2/currencies?size=100&page=1"`
// Use the following script to get all currencies:
/*
n=1; 
while true; do
  response=$(curl -s -X GET "https://exolix.com/api/v2/currencies?size=100&page=$n");
  if echo "$response" | grep -q '"data":\[\]'; then 
    echo "Empty data array found on page $n, stopping.";
    break;
  fi;
  echo "$response" | jq .; 
  ((n++));
done
*/

const EVM_CHAIN_NETWORK = 'evmGeneric'

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  exolixMapping
)

const getNetwork = (wallet: EdgeCurrencyWallet): string | null => {
  const evmChainId = wallet.currencyInfo.evmChainId
  if (evmChainId != null) return EVM_CHAIN_NETWORK
  return MAINNET_CODE_TRANSCRIPTION[
    wallet.currencyInfo.pluginId as EdgeCurrencyPluginId
  ]
}

const orderUri = 'https://exolix.com/transaction/'
const uri = 'https://exolix.com/api/v2/'

const expirationMs = 1000 * 60

const asRateResponse = asObject({
  minAmount: asNumber,
  maxAmount: asNumber,
  withdrawMin: asOptional(asNumber, 0),
  withdrawMax: asOptional(asNumber, 0),
  fromAmount: asNumber,
  toAmount: asNumber,
  message: asEither(asString, asNull),
  rateId: asString
})

const asQuoteInfo = asObject({
  id: asString,
  amount: asNumber,
  amountTo: asNumber,
  depositAddress: asString,
  depositExtraId: asOptional(asString)
})

export function makeExolixPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  const getFixedQuote = async (
    request: EdgeSwapRequestPlugin,
    _userSettings: Object | undefined
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, quoteFor } = request

    const networkFrom = getNetwork(fromWallet)
    const networkTo = getNetwork(toWallet)

    if (networkFrom == null || networkTo == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const networkFromChainId = fromWallet.currencyInfo.evmChainId
    const networkToChainId = toWallet.currencyInfo.evmChainId

    async function call(
      method: 'GET' | 'POST',
      route: string,
      params: any
    ): Promise<Object> {
      const headers: { [header: string]: string } = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `${apiKey}`
      }

      let response: EdgeFetchResponse

      if (method === 'POST') {
        const body = JSON.stringify(params)
        response = await fetchCors(uri + route, {
          method,
          headers,
          body
        })
      } else {
        const url = `${uri}${route}?${new URLSearchParams(params).toString()}`
        response = await fetchCors(url, {
          method,
          headers
        })
      }

      if (!response.ok) {
        if (response.status === 422) {
          // Exolix inconsistently returns a !ok response for a 'from' quote
          // under minimum amount, while the status is OK for a 'to' quote under
          // minimum amount.
          // Handle this inconsistency and ensure parse the proper under min error
          // and we don't exit early with the wrong 'unsupported' error message.
          const resJson = await response.json()
          const maybeMinError = asMaybe(asRateResponse)(resJson)
          if (maybeMinError != null) {
            return resJson
          }

          log.warn(`Error retrieving Exolix quote: ${String(resJson)}`)
          throw new SwapCurrencyError(swapInfo, request)
        }
        throw new Error(`Exolix returned error code ${response.status}`)
      }

      return await response.json()
    }

    const [fromAddress, toAddress] = await Promise.all([
      getAddress(
        request.fromWallet,
        addressTypeMap[request.fromWallet.currencyInfo.pluginId]
      ),
      getAddress(
        request.toWallet,
        addressTypeMap[request.toWallet.currencyInfo.pluginId]
      )
    ])

    let amount
    if (quoteFor === 'from') {
      const quoteAmount = nativeToDenomination(
        request.fromWallet,
        request.nativeAmount,
        request.fromTokenId
      )
      amount = { amount: quoteAmount }
    } else {
      const quoteAmount = nativeToDenomination(
        request.toWallet,
        request.nativeAmount,
        request.toTokenId
      )
      amount = { withdrawalAmount: quoteAmount }
    }

    const {
      fromContractAddress: coinAddressFrom,
      toContractAddress: coinAddressTo
    } = getContractAddresses(request)

    const quoteParams: ExolixQuoteParams = {
      coinAddressFrom,
      networkFrom,
      networkFromChainId,
      coinAddressTo,
      networkTo,
      networkToChainId,
      rateType: 'fixed',
      withdrawalAddress: toAddress,
      refundAddress: fromAddress,
      refundExtraId: '',
      withdrawalExtraId: '',
      ...amount
    }

    // Get Rate
    const rateResponse = asRateResponse(await call('GET', 'rate', quoteParams))

    // Check rate minimum:
    if (quoteFor === 'from') {
      const nativeMin = denominationToNative(
        request.fromWallet,
        rateResponse.minAmount.toString(),
        request.fromTokenId
      )

      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin, 'from')
      }

      const nativeMax = denominationToNative(
        request.fromWallet,
        rateResponse.maxAmount.toString(),
        request.fromTokenId
      )

      if (gt(request.nativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(swapInfo, nativeMax, 'from')
      }
    } else {
      const nativeMin = denominationToNative(
        request.toWallet,
        rateResponse.withdrawMin.toString(),
        request.toTokenId
      )

      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin, 'to')
      }

      const nativeMax = denominationToNative(
        request.fromWallet,
        rateResponse.withdrawMax.toString(),
        request.fromTokenId
      )

      if (gt(request.nativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(swapInfo, nativeMax, 'to')
      }
    }

    // Make the transaction:
    const exchangeParams: ExolixQuoteParams = {
      ...quoteParams,
      rateId: rateResponse.rateId
    }

    // Set the withdrawal amount if we are quoting for the toCurrencyCode

    const callJson = await call('POST', 'transactions', exchangeParams)
    const quoteInfo = asQuoteInfo(callJson)

    const fromNativeAmount = denominationToNative(
      request.fromWallet,
      quoteInfo.amount.toString(),
      request.fromTokenId
    )

    const toNativeAmount = denominationToNative(
      request.toWallet,
      quoteInfo.amountTo.toString(),
      request.toTokenId
    )

    const memos: EdgeMemo[] =
      quoteInfo.depositExtraId == null
        ? []
        : [
            {
              type: memoType(request.fromWallet.currencyInfo.pluginId),
              value: quoteInfo.depositExtraId
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteInfo.depositAddress
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
        orderId: quoteInfo.id,
        orderUri: orderUri + quoteInfo.id,
        isEstimate: false,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: fromNativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: request.toWallet.id,
        refundAddress: fromAddress
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: new Date(Date.now() + expirationMs)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(
        getFixedQuote,
        request,
        userSettings
      )
      const fixedOrder = await getFixedQuote(newRequest, userSettings)
      const fixedResult = await makeSwapPluginQuote(fixedOrder)

      return fixedResult
    }
  }

  return out
}
