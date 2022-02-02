// @flow

import { lt } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  type InvalidCurrencyCodes,
  checkInvalidCodes,
  makeSwapPluginQuote, getCodes
} from '../swap-helpers.js'

const pluginId = 'letsexchange'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'LetsExchange',
  supportEmail: 'support@letsexchange.io'
}

const orderUri = 'https://api.letsexchange.io/?exchangeId='
const uri = 'https://api.letsexchange.io/api/v1/'

const expirationMs = 1000 * 60 * 20

type QuoteInfo = {
  transaction_id: string,
  status: string,
  coin_from: string,
  coin_to: string,
  network_from: string,
  network_to: string,
  deposit_amount: string,
  withdrawal_amount: string,
  deposit: string,
  deposit_extra_id: string,
  withdrawal: string,
  withdrawal_extra_id: string,
  rate: string,
  fee: string,
  return: string,
  return_extra_id: string,
  final_amount: string,
  hash_in: string,
  hash_out: string,
  isEstimate: boolean
}

const dontUseLegacy = {
  DGB: true
}

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    ETH: ['MATIC'],
    AVAX: 'allTokens',
    FTM: 'allTokens',
    MATIC: 'allCodes'
  },
  to: {
    ETH: ['MATIC'],
    AVAX: 'allTokens',
    FTM: 'allTokens',
    MATIC: 'allCodes',
    ZEC: ['ZEC']
  }
}

async function getAddress(wallet: EdgeCurrencyWallet, currencyCode: string) {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

function networkCodeConverter(networkCode: string): string {
  switch (networkCode) {
    case 'ETH':
      networkCode = 'ERC20';
      break;
    case 'BNB':
      networkCode = 'BEP2';
      break;
    case 'TRX':
      networkCode = 'TRC20';
      break;
    case 'BSC':
      networkCode = 'BEP20';
      break;
    default:
      break;
  }

  return networkCode;
}

export function makeLetsExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io, log } = opts
  const { fetchCors = io.fetch } = io

  async function call(url, request, data) {
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
      throw new Error(`letsexchange returned error code ${response.status}`)
    }
    return response.json()
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(request.fromWallet, request.fromCurrencyCode),
        getAddress(request.toWallet, request.toCurrencyCode)
      ])

      const {
        fromCurrencyCode,
        toCurrencyCode,
        fromMainnetCode,
        toMainnetCode
      } = getCodes(request)

      let networkFrom = fromMainnetCode;
      let networkTo = toMainnetCode;

      if (networkFrom !== fromCurrencyCode) {
        networkFrom = networkCodeConverter(networkFrom);
      }

      if (networkTo !== toCurrencyCode) {
        networkTo = networkCodeConverter(networkTo);
      }

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
        from: fromCurrencyCode,
        to: toCurrencyCode,
        network_from: networkFrom,
        network_to: networkTo,
        amount: quoteAmount
      }
      log('quoteParams:', quoteParams)

      // Calculate the amounts:
      let fromAmount, fromNativeAmount, toNativeAmount, reply
      if (request.quoteFor === 'from') {
        reply = await call(uri + 'info', request, {
          params: quoteParams
        })
        fromAmount = quoteAmount
        fromNativeAmount = request.nativeAmount
        toNativeAmount = await request.toWallet.denominationToNative(
          reply.amount.toString(),
          request.toCurrencyCode
        )
      } else {
        reply = await call(uri + 'info-revert', request, {
          params: quoteParams
        })
        fromAmount = reply.amount
        fromNativeAmount = await request.fromWallet.denominationToNative(
          fromAmount.toString(),
          request.fromCurrencyCode
        )
        toNativeAmount = request.nativeAmount
      }
      log('fromNativeAmount' + fromNativeAmount)
      log('toNativeAmount' + toNativeAmount)

      // Check the minimum:
      const nativeMin = await request.fromWallet.denominationToNative(
        reply.min_amount,
        request.fromCurrencyCode
      )
      if (lt(fromNativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }

      const { promoCode } = opts
      const sendReply = await call(uri + 'transaction', request, {
        params: {
          deposit_amount: fromAmount,
          coin_from: fromCurrencyCode,
          coin_to: toCurrencyCode,
          network_from: networkFrom,
          network_to: networkTo,
          withdrawal: toAddress,
          return: fromAddress,
          // return_extra_id: 'empty',
          // withdrawal_extra_id: 'empty',
          return_extra_id: null,
          withdrawal_extra_id: null,
          affiliate_id: initOptions.apiKey,
          promocode: promoCode != null ? promoCode : '',
          type: 'edge',
          float: true,
          isEstimate: false
        }
      })
      log('sendReply' + sendReply)
      const quoteInfo: QuoteInfo = sendReply

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
