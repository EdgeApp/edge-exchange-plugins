// @flow

import { lt } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { getFetchJson } from '../react-native-io'
import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo = {
  pluginName: 'godex',
  displayName: 'Godex',

  quoteUri: 'https://godex.io/exchange/waiting/',
  supportEmail: 'support@godex.io'
}

const uri = 'https://api.godex.io/api/v1/'

const expirationMs = 1000 * 60 * 20

type QuoteInfo = {
  transaction_id: string,
  status: string,
  coin_from: string,
  coin_to: string,
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

async function getAddress(wallet: EdgeCurrencyWallet, currencyCode: string) {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeGodexPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, initOptions } = opts
  const fetchJson = getFetchJson(opts)

  async function call(url, request, data) {
    const body = JSON.stringify(data.params)

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    const reply = await fetchJson(url, { method: 'POST', body, headers })
    if (!reply.ok) {
      if (reply.status === 422) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      }
      throw new Error(`godex returned error code ${reply.status}`)
    }
    const out = reply.json
    return out
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      if (request.fromCurrencyCode === 'USDT') {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      }
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

      // Swap the currencies if we need a reverse quote:
      const quoteParams = {
        from: request.fromCurrencyCode,
        to: request.toCurrencyCode,
        amount: quoteAmount
      }

      io.console.info('quoteParams:', quoteParams)

      // Get the estimate from the server:

      io.console.info('godex info api')

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
      io.console.info('fromNativeAmount' + fromNativeAmount)
      io.console.info('toNativeAmount' + toNativeAmount)

      // Check the minimum:
      const nativeMin = await request.fromWallet.denominationToNative(
        reply.min_amount,
        request.fromCurrencyCode
      )
      if (lt(fromNativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }

      const sendReply = await call(uri + 'transaction', request, {
        params: {
          deposit_amount: fromAmount,
          coin_from: request.fromCurrencyCode,
          coin_to: request.toCurrencyCode,
          withdrawal: toAddress,
          return: fromAddress,
          // return_extra_id: 'empty',
          // withdrawal_extra_id: 'empty',
          return_extra_id: null,
          withdrawal_extra_id: null,
          affiliate_id: initOptions.apiKey,
          type: 'edge',
          isEstimate: false
        }
      })
      io.console.info('sendReply' + sendReply)
      const quoteInfo: QuoteInfo = sendReply

      // Make the transaction:
      const spendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: quoteInfo.deposit,
            otherParams: {
              uniqueIdentifier: quoteInfo.deposit_extra_id
            }
          }
        ]
      }
      io.console.info('godex spendInfo', spendInfo)

      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)
      if (!tx.otherParams) tx.otherParams = {}
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'godex',
        false, // isEstimate, correct?
        new Date(Date.now() + expirationMs),
        quoteInfo.transaction_id
      )
    }
  }

  return out
}
