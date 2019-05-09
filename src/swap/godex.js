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
import { base16 } from 'rfc4648'
import hashjs from 'hash.js'
import utf8Codec from 'utf8'


import { makeSwapPluginQuote } from '../swap-helpers.js'
import {getFetchJson} from "../react-native-io";


function hmacSha512 (data: Uint8Array, key: Uint8Array): Uint8Array {
  const hmac = hashjs.hmac(hashjs.sha512, key)
  return hmac.update(data).digest()
}
const swapInfo = {
  pluginName: 'godex',
  displayName: 'godex',

  quoteUri: 'https://godex.io/exchange/status/#',
  supportEmail: 'support@godex.io'
}

const uri = 'https://api.godex.io/api/v1/'




function parseUtf8 (text: string): Uint8Array {
  const byteString: string = utf8Codec.encode(text)
  const out = new Uint8Array(byteString.length)

  for (let i = 0; i < byteString.length; ++i) {
    out[i] = byteString.charCodeAt(i)
  }

  return out
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
  const fetchJson = getFetchJson(opts)

  io.console.info(initOptions);


  async function call (url, data) {
    io.console.info('call data:', data.params)
    // const body = data.params;
    const body = JSON.stringify(data.params)
    //   io.console.info(body);
    // const sign = base16
    //     .stringify(hmacSha512(parseUtf8(body), secret))
    //     .toLowerCase()
    // const sign = base16
    //     .stringify(hmacSha512(parseUtf8(body)))
    //     .toLowerCase()

    // io.console.info('sign')
    // io.console.info(sign)
    io.console.info('godex call:', url)
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // 'api-key': apiKey,
      // sign
    }
    const reply = await fetchJson(url, { method: 'POST', body, headers })
     io.console.info('godex reply:', reply);
    if (!reply.ok) {
      throw new Error(`godex returned error code ${reply.status}`)
    }
    const out = reply.json
    io.console.info('changelly reply:', out)
    return out
  }

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
      io.console.info('godex quoteAmount:', quoteAmount);

      // Swap the currencies if we need a reverse quote:
      const quoteParams =
          request.quoteFor === 'from'
              ? {
                from: request.fromCurrencyCode,
                to: request.toCurrencyCode,
                amount: quoteAmount
              }
              : {
                from: request.toCurrencyCode,
                to: request.fromCurrencyCode,
                amount: quoteAmount
              }

      // Get the estimate from the server:
      const quoteReplies = await Promise.all([
        call(uri+'info',{
          params: {
            quoteParams
            // amount: quoteAmount,
            // from: request.fromCurrencyCode,
            // to: request.toCurrencyCode
          }
        })
        // ,
        // call({
        //   jsonrpc: '2.0',
        //   id: 'two',
        //   method: 'getExchangeAmount',
        //   params: quoteParams
        // })
      ])
      io.console.info('godex info api');
      io.console.info(quoteReplies);
      // checkReply(quoteReplies[0])
      // checkReply(quoteReplies[1])

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
