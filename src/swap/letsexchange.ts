import { gt, lt } from 'biggystring'
import { asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
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

import {
  checkInvalidCodes,
  getCodesWithTranscription,
  InvalidCurrencyCodes,
  makeSwapPluginQuote
} from '../swap-helpers'
import { convertRequest } from '../util/utils'
import { asOptionalBlank } from './changenow'
import { EdgeSwapRequestPlugin } from './types'

const pluginId = 'letsexchange'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'LetsExchange',
  supportEmail: 'support@letsexchange.io'
}

const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString)
})

const orderUri = 'https://letsexchange.io/?exchangeId='
const uri = 'https://api.letsexchange.io/api/v1/'

const expirationMs = 1000 * 60

const asQuoteInfo = asObject({
  transaction_id: asString,
  deposit_amount: asString,
  deposit: asString,
  deposit_extra_id: asOptionalBlank(asString),
  withdrawal_amount: asString,
  withdrawal_extra_id: asOptionalBlank(asString)
})

const asInfoReply = asObject({
  min_amount: asString,
  max_amount: asString,
  amount: asString
})
const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

const MAINNET_CODE_TRANSCRIPTION = {
  ethereum: 'ERC20',
  binancesmartchain: 'BEP20',
  tron: 'TRC20',
  binance: 'BEP2',
  rsk: 'RSK',
  avalanche: 'AVAXC'
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const { publicAddress } = await wallet.getReceiveAddress({ currencyCode })
  return publicAddress
}

export function makeLetsExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)

  async function call(
    url: string,
    request: EdgeSwapRequestPlugin,
    data: { params: Object }
  ): Promise<Object> {
    const body = JSON.stringify(data.params)

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${initOptions.apiKey}`,
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
      throw new Error(`letsexchange returned error code ${response.status}`)
    }
    return await response.json()
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
      const reverseQuote = request.quoteFor === 'to'

      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(request.fromWallet, request.fromCurrencyCode),
        getAddress(request.toWallet, request.toCurrencyCode)
      ])

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

      const { fromMainnetCode, toMainnetCode } = getCodesWithTranscription(
        request,
        MAINNET_CODE_TRANSCRIPTION
      )

      const networkFrom =
        request.fromCurrencyCode ===
        request.fromWallet.currencyInfo.currencyCode
          ? request.fromCurrencyCode
          : fromMainnetCode

      const networkTo =
        request.toCurrencyCode === request.toWallet.currencyInfo.currencyCode
          ? request.toCurrencyCode
          : toMainnetCode

      // Swap the currencies if we need a reverse quote:
      const quoteParams = {
        from: request.fromCurrencyCode,
        to: request.toCurrencyCode,
        network_from: networkFrom,
        network_to: networkTo,
        amount: quoteAmount
      }

      log('quoteParams:', quoteParams)

      // Calculate the amounts:
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
      const reply = asInfoReply(response)

      // Check the min/max:
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

      const nativeMax = reverseQuote
        ? await request.toWallet.denominationToNative(
            reply.max_amount,
            request.toCurrencyCode
          )
        : await request.fromWallet.denominationToNative(
            reply.max_amount,
            request.fromCurrencyCode
          )

      if (gt(nativeMax, '0')) {
        if (gt(request.nativeAmount, nativeMax)) {
          throw new SwapAboveLimitError(
            swapInfo,
            nativeMin,
            reverseQuote ? 'to' : 'from'
          )
        }
      }

      const { promoCode } = opts
      endpoint = reverseQuote ? 'transaction-revert' : 'transaction'
      const sendReply = await call(uri + endpoint, request, {
        params: {
          deposit_amount: reverseQuote ? undefined : fromAmount,
          withdrawal_amount: reverseQuote ? toAmount : undefined,
          coin_from: request.fromCurrencyCode,
          coin_to: request.toCurrencyCode,
          network_from: networkFrom,
          network_to: networkTo,
          withdrawal: toAddress,
          return: fromAddress,
          return_extra_id: null,
          withdrawal_extra_id: null,
          affiliate_id: initOptions.affiliateId,
          promocode: promoCode != null ? promoCode : '',
          type: 'edge',
          float: false,
          isEstimate: false
        }
      })

      log('sendReply', sendReply)
      const quoteInfo = asQuoteInfo(sendReply)

      const fromNativeAmount = await request.fromWallet.denominationToNative(
        quoteInfo.deposit_amount,
        request.fromCurrencyCode
      )
      const toNativeAmount = await request.toWallet.denominationToNative(
        quoteInfo.withdrawal_amount,
        request.toCurrencyCode
      )

      // Make the transaction:
      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: quoteInfo.deposit,
            uniqueIdentifier: quoteInfo.deposit_extra_id
          }
        ],
        networkFeeOption:
          request.fromCurrencyCode.toUpperCase() === 'BTC'
            ? 'high'
            : 'standard',
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

      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'letsexchange',
        false, // isEstimate, correct?
        new Date(Date.now() + expirationMs),
        quoteInfo.transaction_id
      )
    }
  }

  return out
}
