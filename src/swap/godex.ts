import { lt } from 'biggystring'
import {
  asArray,
  asEither,
  asMaybe,
  asNull,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  JsonObject,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  getCodesWithTranscription,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../swap-helpers'
import { convertRequest } from '../util/utils'
import { asNumberString, EdgeSwapRequestPlugin } from './types'

const pluginId = 'godex'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Godex',
  supportEmail: 'support@godex.io'
}

const asInitOptions = asObject({
  apiKey: asOptional(asString)
})

const orderUri = 'https://godex.io/exchange/waiting/'
const uri = 'https://api.godex.io/api/v1/'

const expirationMs = 1000 * 60

const asApiInfo = asObject({
  min_amount: asNumberString,
  networks_from: asMaybe(
    asArray(
      asObject({
        network: asString
      })
    )
  ),
  networks_to: asMaybe(
    asArray(
      asObject({
        network: asString
      })
    )
  )
})

const asQuoteInfo = asObject({
  transaction_id: asString,
  deposit: asString,
  deposit_extra_id: asEither(asString, asNull),
  deposit_amount: asString,
  withdrawal: asString,
  withdrawal_extra_id: asEither(asString, asNull),
  withdrawal_amount: asString,
  return: asString,
  return_extra_id: asEither(asString, asNull)
})

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    ethereum: ['MATIC'],
    avalanche: 'allTokens',
    celo: 'allTokens',
    fantom: 'allTokens',
    polygon: 'allCodes',
    digibyte: 'allCodes'
  },
  to: {
    ethereum: ['MATIC'],
    avalanche: 'allTokens',
    celo: 'allTokens',
    fantom: 'allTokens',
    polygon: 'allCodes',
    zcash: ['ZEC']
  }
}

// Network names that don't match parent network currency code
const MAINNET_CODE_TRANSCRIPTION = {
  rsk: 'RSK',
  binancesmartchain: 'BSC',
  avalanche: 'AVAXC'
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const { publicAddress } = await wallet.getReceiveAddress({ currencyCode })
  return publicAddress
}

export function makeGodexPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)

  async function call(
    url: string,
    request: EdgeSwapRequestPlugin,
    data: { params: JsonObject }
  ): Promise<JsonObject> {
    const body = JSON.stringify(data.params)

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    const response = await fetchCors(url, { method: 'POST', body, headers })
    if (!response.ok) {
      if (response.status === 422) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      }
      throw new Error(`godex returned error code ${response.status}`)
    }
    return await response.json()
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const reverseQuote = request.quoteFor === 'to'

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])

    const { fromMainnetCode, toMainnetCode } = getCodesWithTranscription(
      request,
      MAINNET_CODE_TRANSCRIPTION
    )

    // Convert the native amount to a denomination:
    const quoteAmount =
      request.quoteFor === 'from'
        ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            request.fromCurrencyCode
          )
        : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            request.toCurrencyCode
          )

    // Swap the currencies if we need a reverse quote:
    const quoteParams = {
      from: request.fromCurrencyCode,
      to: request.toCurrencyCode,
      amount: quoteAmount
    }
    log('quoteParams:', quoteParams)

    // Check if we are below the minimum limit:
    let fromAmount, toAmount, endpoint
    if (request.quoteFor === 'from') {
      fromAmount = quoteAmount
      endpoint = 'info'
    } else {
      toAmount = quoteAmount
      endpoint = 'info-revert'
    }
    const response = await call(uri + endpoint, request, {
      params: quoteParams
    })
    const reply = asApiInfo(response)

    // The info/info-revert endpoints don't accept the coin_from/coin_to params so the
    // min_amount returned could be for a different network than the user is requesting.
    // Check the minimum:
    const nativeMin = reverseQuote
      ? await request.toWallet.denominationToNative(
          reply.min_amount,
          request.toCurrencyCode
        )
      : await request.fromWallet.denominationToNative(
          reply.min_amount,
          request.fromCurrencyCode
        )

    if (lt(request.nativeAmount, nativeMin)) {
      throw new SwapBelowLimitError(
        swapInfo,
        nativeMin,
        reverseQuote ? 'to' : 'from'
      )
    }

    // Check the networks. Networks aren't present for disabled assets.
    if (
      reply.networks_from?.find(
        network => network.network === fromMainnetCode
      ) == null ||
      reply.networks_to?.find(network => network.network === toMainnetCode) ==
        null
    ) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }

    const { promoCode } = opts

    endpoint = reverseQuote ? 'transaction-revert' : 'transaction'
    const sendReply = await call(
      uri + endpoint + (promoCode != null ? `?promo=${promoCode}` : ''),
      request,
      {
        params: {
          deposit_amount: reverseQuote ? undefined : fromAmount,
          withdrawal_amount: reverseQuote ? toAmount : undefined,
          coin_from: request.fromCurrencyCode,
          coin_to: request.toCurrencyCode,
          withdrawal: toAddress,
          return: fromAddress,
          return_extra_id: null,
          withdrawal_extra_id: null,
          affiliate_id: initOptions.apiKey,
          type: 'edge',
          isEstimate: false,
          coin_from_network: fromMainnetCode,
          coin_to_network: toMainnetCode
        }
      }
    )
    log('sendReply' + JSON.stringify(sendReply, null, 2))
    const quoteInfo = asQuoteInfo(sendReply)
    const fromNativeAmount = await request.fromWallet.denominationToNative(
      quoteInfo.deposit_amount,
      request.fromCurrencyCode
    )
    const toNativeAmount = await request.toWallet.denominationToNative(
      quoteInfo.withdrawal_amount,
      request.toCurrencyCode
    )

    log('fromNativeAmount: ' + fromNativeAmount)
    log('toNativeAmount: ' + toNativeAmount)

    // Make the transaction:
    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteInfo.deposit,
          uniqueIdentifier: quoteInfo.deposit_extra_id ?? undefined
        }
      ],
      networkFeeOption:
        request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
      swapData: {
        orderId: quoteInfo.transaction_id,
        orderUri: orderUri + quoteInfo.transaction_id,
        isEstimate: false,
        payoutAddress: toAddress,
        payoutCurrencyCode: request.toCurrencyCode,
        payoutNativeAmount: toNativeAmount,
        payoutWalletId: request.toWallet.id,
        plugin: { ...swapInfo },
        refundAddress: fromAddress
      }
    }
    log('spendInfo', spendInfo)

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
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      const newRequest = await getMaxSwappable(
        fetchSwapQuoteInner,
        request,
        opts
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest, opts)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
