import { lt } from 'biggystring'
import { asObject, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  getCodesWithMainnetTranscription,
  InvalidCurrencyCodes,
  makeSwapPluginQuote
} from '../swap-helpers'
import { asOptionalBlank } from './changenow'

const pluginId = 'letsexchange'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'LetsExchange',
  supportEmail: 'support@letsexchange.io'
}

const orderUri = 'https://letsexchange.io/?exchangeId='
const uri = 'https://api.letsexchange.io/api/v1/'

const expirationMs = 1000 * 60

const asQuoteInfo = asObject({
  transaction_id: asString,
  status: asString,
  coin_from: asString,
  coin_to: asString,
  coin_from_network: asString,
  coin_to_network: asString,
  deposit_amount: asString,
  withdrawal_amount: asString,
  deposit: asString,
  deposit_extra_id: asOptionalBlank(asString),
  withdrawal: asString,
  withdrawal_extra_id: asOptionalBlank(asString),
  rate: asString,
  fee: asString,
  return: asString,
  hash_in: asOptionalBlank(asString),
  hash_out: asOptionalBlank(asString)
})

const asInfoReply = asObject({
  min_amount: asString,
  amount: asString
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
  const { initOptions, io, log } = opts
  const { fetchCors = io.fetch } = io

  async function call(
    url: string,
    request: EdgeSwapRequest,
    data: { params: Object }
  ): Promise<Object> {
    const body = JSON.stringify(data.params)

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${initOptions.apiKey.toString()}`,
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
      request: EdgeSwapRequest,
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

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

      const {
        fromMainnetCode,
        toMainnetCode
      } = getCodesWithMainnetTranscription(request, MAINNET_CODE_TRANSCRIPTION)

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
      let fromAmount, fromNativeAmount, toNativeAmount, reply
      if (request.quoteFor === 'from') {
        reply = asInfoReply(
          await call(uri + 'info', request, {
            params: quoteParams
          })
        )

        fromNativeAmount = request.nativeAmount

        // Check the minimum:
        const nativeMin = await request.fromWallet.denominationToNative(
          reply.min_amount,
          request.fromCurrencyCode
        )

        if (lt(fromNativeAmount, nativeMin) === true) {
          throw new SwapBelowLimitError(swapInfo, nativeMin)
        }

        fromAmount = quoteAmount
        toNativeAmount = await request.toWallet.denominationToNative(
          reply.amount.toString(),
          request.toCurrencyCode
        )
      } else {
        reply = await asInfoReply(
          call(uri + 'info-revert', request, {
            params: quoteParams
          })
        )

        toNativeAmount = request.nativeAmount

        // Check the minimum:
        const nativeMin = await request.toWallet.denominationToNative(
          reply.min_amount,
          request.toCurrencyCode
        )

        if (lt(toNativeAmount, nativeMin) === true) {
          throw new SwapBelowLimitError(swapInfo, nativeMin, 'to')
        }

        fromAmount = reply.amount
        fromNativeAmount = await request.fromWallet.denominationToNative(
          fromAmount.toString(),
          request.fromCurrencyCode
        )
      }

      const { promoCode } = opts
      const sendReply = await call(uri + 'transaction', request, {
        params: {
          deposit_amount: fromAmount,
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
