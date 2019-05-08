// @flow

import { gt, lt } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSpendInfo,
  type EdgeSpendTarget,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo = {
  pluginName: 'godex',
  displayName: 'godex',

  quoteUri: 'https://godex.io/exchange/status/#',
  supportEmail: 'support@godex.io'
}

const API_PREFIX = 'https://api.godex.io/api/v1'

type GodexQuoteJson = {
  swap_id: string,
  created_at: string,
  deposit_address: string,
  deposit_amount: number,
  deposit_currency: string,
  spot_price: number,
  price: number,
  price_locked_at: string,
  price_locked_until: string,
  withdrawal_amount: number,
  withdrawal_address: string,
  withdrawal_currency: string,
  refund_address?: string,
  user_id?: string,
  terms?: string
}

const dontUseLegacy = {
  DGB: true
}

export function makeGodexPlugin (opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, initOptions } = opts

  io.console.info(initOptions);

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote (
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      io.console.info(request);
      io.console.info(userSettings);

      // const fromNativeAmount = await fromWallet.denominationToNative(
      //     quoteData.deposit_amount.toString(),
      //     fromCurrencyCode
      // )
      // const toNativeAmount = await toWallet.denominationToNative(
      //     quoteData.withdrawal_amount.toString(),
      //     toCurrencyCode
      // )

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

      // Calculate the amounts:
      let fromAmount, fromNativeAmount, toNativeAmount
      if (request.quoteFor === 'from') {
        fromAmount = quoteAmount
        fromNativeAmount = request.nativeAmount
        toNativeAmount = await request.toWallet.denominationToNative(
            quoteReplies[1].result,
            request.toCurrencyCode
        )
      } else {
        fromAmount = mul(quoteReplies[1].result, '1.02')
        fromNativeAmount = await request.fromWallet.denominationToNative(
            fromAmount,
            request.fromCurrencyCodequoteAmount
        )
        toNativeAmount = request.nativeAmount
      }


      io.console.info(fromNativeAmount);

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'godex',
        new Date(quoteData.price_locked_until),
        quoteData.swap_id
      )
    }
  }

  io.console.info(out);
  return out
}
