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
  SwapAboveLimitError,
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
import { asOptionalBlank } from './changenow'
import { asNumberString, EdgeSwapRequestPlugin } from './types'

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
  min_amount: asNumberString,
  max_amount: asNumberString,
  amount: asNumberString
})
const dontUseLegacy: { [cc: string]: boolean } = {
  DGB: true
}

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
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress != null && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
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

      const fetchSwapQuoteInner = async (
        requestInner: EdgeSwapRequestPlugin
      ): Promise<SwapOrder> => {
        // Convert the native amount to a denomination:
        const quoteAmount =
          requestInner.quoteFor === 'from'
            ? await requestInner.fromWallet.nativeToDenomination(
                requestInner.nativeAmount,
                requestInner.fromCurrencyCode
              )
            : await requestInner.toWallet.nativeToDenomination(
                requestInner.nativeAmount,
                requestInner.toCurrencyCode
              )

        const { fromMainnetCode, toMainnetCode } = getCodesWithTranscription(
          requestInner,
          MAINNET_CODE_TRANSCRIPTION
        )

        const networkFrom =
          requestInner.fromCurrencyCode ===
          requestInner.fromWallet.currencyInfo.currencyCode
            ? requestInner.fromCurrencyCode
            : fromMainnetCode

        const networkTo =
          requestInner.toCurrencyCode ===
          requestInner.toWallet.currencyInfo.currencyCode
            ? requestInner.toCurrencyCode
            : toMainnetCode

        // Swap the currencies if we need a reverse quote:
        const quoteParams = {
          from: requestInner.fromCurrencyCode,
          to: requestInner.toCurrencyCode,
          network_from: networkFrom,
          network_to: networkTo,
          amount: quoteAmount
        }

        log('quoteParams:', quoteParams)

        // Calculate the amounts:
        let fromAmount, toAmount, endpoint
        if (requestInner.quoteFor === 'from') {
          fromAmount = quoteAmount
          endpoint = 'info'
        } else {
          toAmount = quoteAmount
          endpoint = 'info-revert'
        }
        const response = await call(uri + endpoint, requestInner, {
          params: quoteParams
        })
        const reply = asInfoReply(response)

        // Check the min/max:
        const nativeMin = reverseQuote
          ? await requestInner.toWallet.denominationToNative(
              reply.min_amount,
              requestInner.toCurrencyCode
            )
          : await requestInner.fromWallet.denominationToNative(
              reply.min_amount,
              requestInner.fromCurrencyCode
            )

        if (lt(requestInner.nativeAmount, nativeMin)) {
          throw new SwapBelowLimitError(
            swapInfo,
            nativeMin,
            reverseQuote ? 'to' : 'from'
          )
        }

        const nativeMax = reverseQuote
          ? await requestInner.toWallet.denominationToNative(
              reply.max_amount,
              requestInner.toCurrencyCode
            )
          : await requestInner.fromWallet.denominationToNative(
              reply.max_amount,
              requestInner.fromCurrencyCode
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
        const sendReply = await call(uri + endpoint, requestInner, {
          params: {
            deposit_amount: reverseQuote ? undefined : fromAmount,
            withdrawal_amount: reverseQuote ? toAmount : undefined,
            coin_from: requestInner.fromCurrencyCode,
            coin_to: requestInner.toCurrencyCode,
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

        const fromNativeAmount = await requestInner.fromWallet.denominationToNative(
          quoteInfo.deposit_amount,
          requestInner.fromCurrencyCode
        )
        const toNativeAmount = await requestInner.toWallet.denominationToNative(
          quoteInfo.withdrawal_amount,
          requestInner.toCurrencyCode
        )

        // Make the transaction:
        const spendInfo: EdgeSpendInfo = {
          currencyCode: requestInner.fromCurrencyCode,
          spendTargets: [
            {
              nativeAmount: fromNativeAmount,
              publicAddress: quoteInfo.deposit,
              uniqueIdentifier: quoteInfo.deposit_extra_id
            }
          ],
          networkFeeOption:
            requestInner.fromCurrencyCode.toUpperCase() === 'BTC'
              ? 'high'
              : 'standard',
          swapData: {
            orderId: quoteInfo.transaction_id,
            orderUri: orderUri + quoteInfo.transaction_id,
            isEstimate: false,
            payoutAddress: toAddress,
            payoutCurrencyCode: requestInner.toCurrencyCode,
            payoutNativeAmount: toNativeAmount,
            payoutWalletId: requestInner.toWallet.id,
            plugin: { ...swapInfo },
            refundAddress: fromAddress
          }
        }

        log('spendInfo', spendInfo)

        const order = {
          request: requestInner,
          spendInfo,
          pluginId,
          expirationDate: new Date(Date.now() + expirationMs)
        }

        return order
      }

      const { request: newRequest } = await getMaxSwappable(
        fetchSwapQuoteInner,
        request
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
