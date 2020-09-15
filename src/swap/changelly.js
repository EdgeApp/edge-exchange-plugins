// @flow

import { gt, lt, mul } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'
import hashjs from 'hash.js'
import { base16 } from 'rfc4648'
import utf8Codec from 'utf8'

import { makeSwapPluginQuote } from '../swap-helpers.js'

const INVALID_CURRENCY_CODES = {}

// Invalid currency codes should *not* have transcribed codes
// because currency codes with transcribed versions are NOT invalid
const CURRENCY_CODE_TRANSCRIPTION = {
  // Edge currencyCode: exchangeCurrencyCode
  USDT: 'USDT20'
}

function hmacSha512(data: Uint8Array, key: Uint8Array): Uint8Array {
  const hmac = hashjs.hmac(hashjs.sha512, key)
  return hmac.update(data).digest()
}

function parseUtf8(text: string): Uint8Array {
  const byteString: string = utf8Codec.encode(text)
  const out = new Uint8Array(byteString.length)

  for (let i = 0; i < byteString.length; ++i) {
    out[i] = byteString.charCodeAt(i)
  }

  return out
}

const pluginId = 'changelly'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Changelly',

  supportEmail: 'support@changelly.com'
}

const orderUri = 'https://changelly.com/transaction/'
const uri = 'https://api.changelly.com'
const expirationMs = 1000 * 60 * 20
const expirationFixedMs = 1000 * 60 * 5
type QuoteInfo = {
  id: string,
  apiExtraFee: string,
  changellyFee: string,
  payinExtraId: string | null,
  payoutExtraId: string | null,
  amountExpectedFrom: number,
  status: string,
  currencyFrom: string,
  currencyTo: string,
  amountTo: number,
  payinAddress: string,
  payoutAddress: string,
  createdAt: string
}
type FixedQuoteInfo = {
  id: string,
  amountExpectedFrom: string,
  amountExpectedTo: string,
  amountTo: number,
  apiExtraFee: string,
  changellyFee: string,
  createdAt: string,
  currencyFrom: string,
  currencyTo: string,
  kycRequired: boolean,
  payinAddress: string,
  payinExtraId: string | null,
  payoutAddress: string,
  payoutExtraId: string | null,
  refundAddress: string,
  refundExtraId: string | null,
  status: string
}

const dontUseLegacy = {
  DGB: true
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

function checkReply(reply: Object, request: EdgeSwapRequest) {
  if (reply.error != null) {
    if (
      reply.error.code === -32602 ||
      /Invalid currency:/.test(reply.error.message)
    ) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }
    throw new Error('Changelly error: ' + JSON.stringify(reply.error))
  }
}

export function makeChangellyPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io, log } = opts
  const { fetchCors = io.fetch } = io

  if (initOptions.apiKey == null || initOptions.secret == null) {
    throw new Error('No Changelly apiKey or secret provided.')
  }
  const { apiKey } = initOptions
  const secret = parseUtf8(initOptions.secret)

  async function call(json: any, promoCode?: string) {
    const body = JSON.stringify(json)
    const sign = base16
      .stringify(hmacSha512(parseUtf8(body), secret))
      .toLowerCase()

    const headers: { [header: string]: string } = {
      'Content-Type': 'application/json',
      'api-key': apiKey,
      sign
    }
    if (promoCode != null) headers['X-Promo-Code'] = promoCode
    const response = await fetchCors(uri, { method: 'POST', body, headers })

    if (!response.ok) {
      throw new Error(`Changelly returned error code ${response.status}`)
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
      if (
        // if either currencyCode is invalid *and* doesn't have a transcription
        INVALID_CURRENCY_CODES[request.fromCurrencyCode] ||
        INVALID_CURRENCY_CODES[request.toCurrencyCode]
      ) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      }
      const fixedPromise = this.getFixedQuote(request, userSettings, opts)
      const estimatePromise = this.getEstimate(request, userSettings, opts)
      try {
        const fixedResult = await fixedPromise
        return fixedResult
      } catch (e) {
        const estimateResult = await estimatePromise
        return estimateResult
      }
    },

    async getFixedQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const { promoCode } = opts
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(request.fromWallet, request.fromCurrencyCode),
        getAddress(request.toWallet, request.toCurrencyCode)
      ])
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

      let safeFromCurrencyCode = request.fromCurrencyCode
      let safeToCurrencyCode = request.toCurrencyCode
      if (CURRENCY_CODE_TRANSCRIPTION[request.fromCurrencyCode]) {
        safeFromCurrencyCode =
          CURRENCY_CODE_TRANSCRIPTION[request.fromCurrencyCode]
      }
      if (CURRENCY_CODE_TRANSCRIPTION[request.toCurrencyCode]) {
        safeToCurrencyCode = CURRENCY_CODE_TRANSCRIPTION[request.toCurrencyCode]
      }
      const fixedRateQuote = await call({
        jsonrpc: '2.0',
        id: 'one',
        method: 'getFixRate',
        params: {
          from: safeFromCurrencyCode,
          to: safeToCurrencyCode
        }
      })
      const min =
        request.quoteFor === 'from'
          ? fixedRateQuote.result.minFrom
          : fixedRateQuote.result.minTo
      const max =
        request.quoteFor === 'from'
          ? fixedRateQuote.result.maxFrom
          : fixedRateQuote.result.maxTo
      const nativeMin = await request.fromWallet.denominationToNative(
        min,
        request.fromCurrencyCode
      )
      const nativeMax = await request.fromWallet.denominationToNative(
        max,
        request.fromCurrencyCode
      )
      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }
      if (gt(request.nativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(swapInfo, nativeMax)
      }
      const params =
        request.quoteFor === 'from'
          ? {
              amount: quoteAmount,
              from: safeFromCurrencyCode,
              to: safeToCurrencyCode,
              address: toAddress,
              extraId: null,
              refundAddress: fromAddress,
              refundExtraId: null,
              rateId: fixedRateQuote.result.id
            }
          : {
              amountTo: quoteAmount,
              from: safeFromCurrencyCode,
              to: safeToCurrencyCode,
              address: toAddress,
              extraId: null,
              refundAddress: fromAddress,
              refundExtraId: null,
              rateId: fixedRateQuote.result.id
            }

      const sendReply = await call(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'createFixTransaction',
          params
        },
        promoCode
      )
      checkReply(sendReply, request)
      const quoteInfo: FixedQuoteInfo = sendReply.result
      const spendInfoAmount = await request.fromWallet.denominationToNative(
        quoteInfo.amountExpectedFrom,
        // need to verify that this is okay
        // why use currencyCode from quoteInfo in the first place?
        request.fromCurrencyCode.toUpperCase()
      )

      const amountExpectedFromNative = await request.fromWallet.denominationToNative(
        sendReply.result.amountExpectedFrom,
        request.fromCurrencyCode
      )
      const amountExpectedToTo = await request.fromWallet.denominationToNative(
        sendReply.result.amountExpectedTo,
        request.toCurrencyCode
      )

      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: spendInfoAmount,
            publicAddress: quoteInfo.payinAddress,
            uniqueIdentifier: quoteInfo.payinExtraId || undefined
          }
        ],
        networkFeeOption:
          request.fromCurrencyCode.toUpperCase() === 'BTC'
            ? 'high'
            : 'standard',
        swapData: {
          orderId: quoteInfo.id,
          orderUri: orderUri + quoteInfo.id,
          isEstimate: false,
          payoutAddress: toAddress,
          payoutCurrencyCode: request.toCurrencyCode,
          payoutNativeAmount: amountExpectedToTo,
          payoutWalletId: request.toWallet.id,
          plugin: { ...swapInfo },
          refundAddress: fromAddress
        }
      }
      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)

      return makeSwapPluginQuote(
        request,
        amountExpectedFromNative,
        amountExpectedToTo,
        tx,
        toAddress,
        'changelly',
        false,
        new Date(Date.now() + expirationFixedMs),
        quoteInfo.id
      )
    },

    async getEstimate(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const { promoCode } = opts
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

      let safeFromCurrencyCode = request.fromCurrencyCode
      let safeToCurrencyCode = request.toCurrencyCode
      if (CURRENCY_CODE_TRANSCRIPTION[request.fromCurrencyCode]) {
        safeFromCurrencyCode =
          CURRENCY_CODE_TRANSCRIPTION[request.fromCurrencyCode]
      }
      if (CURRENCY_CODE_TRANSCRIPTION[request.toCurrencyCode]) {
        safeToCurrencyCode = CURRENCY_CODE_TRANSCRIPTION[request.toCurrencyCode]
      }
      // Swap the currencies if we need a reverse quote:
      const quoteParams =
        request.quoteFor === 'from'
          ? {
              from: safeFromCurrencyCode,
              to: safeToCurrencyCode,
              amount: quoteAmount
            }
          : {
              from: safeToCurrencyCode,
              to: safeFromCurrencyCode,
              amount: quoteAmount
            }

      // Get the estimate from the server:
      const quoteReplies = await Promise.all([
        call({
          jsonrpc: '2.0',
          id: 'one',
          method: 'getMinAmount',
          params: {
            from: safeFromCurrencyCode,
            to: safeToCurrencyCode
          }
        }),
        call({
          jsonrpc: '2.0',
          id: 'two',
          method: 'getExchangeAmount',
          params: quoteParams
        })
      ])
      checkReply(quoteReplies[0], request)

      // Check the minimum:
      const nativeMin = await request.fromWallet.denominationToNative(
        quoteReplies[0].result,
        request.fromCurrencyCode
      )
      if (lt(request.nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }

      checkReply(quoteReplies[1], request)

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
          request.fromCurrencyCode
        )
        toNativeAmount = request.nativeAmount
      }

      // Get the address:
      const sendReply = await call(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'createTransaction',
          params: {
            amount: fromAmount,
            from: safeFromCurrencyCode,
            to: safeToCurrencyCode,
            address: toAddress,
            extraId: null, // TODO: Do we need this for Monero?
            refundAddress: fromAddress,
            refundExtraId: null
          }
        },
        promoCode
      )
      checkReply(sendReply, request)
      const quoteInfo: QuoteInfo = sendReply.result
      // Make the transaction:
      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: quoteInfo.payinAddress,
            uniqueIdentifier: quoteInfo.payinExtraId || undefined
          }
        ],
        swapData: {
          orderId: quoteInfo.id,
          orderUri: orderUri + quoteInfo.id,
          isEstimate: true,
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

      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'changelly',
        true,
        new Date(Date.now() + expirationMs),
        quoteInfo.id
      )
    }
  }

  return out
}
