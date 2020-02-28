// @flow

import { gt, lt, mul } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
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

const swapInfo: EdgeSwapInfo = {
  pluginId: 'sideshift',
  displayName: 'SideShift',

  supportEmail: 'support@sideshift.ai'
}

const uri = 'https://staging.sideshift.ai/changelly-api'
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
    throw new Error('SideShift error: ' + JSON.stringify(reply.error))
  }
}

export function makeSideShiftPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io, log } = opts

  if (initOptions.apiKey == null || initOptions.secret == null) {
    throw new Error('No SideShift apiKey or secret provided.')
  }
  const { apiKey } = initOptions
  const secret = parseUtf8(initOptions.secret)

  async function call(json: any) {
    const body = JSON.stringify(json)
    const sign = base16
      .stringify(hmacSha512(parseUtf8(body), secret))
      .toLowerCase()

    const headers = {
      'Content-Type': 'application/json',
      'api-key': apiKey,
      sign
    }
    const response = await io.fetch(uri, { method: 'POST', body, headers })

    if (!response.ok) {
      throw new Error(`SideShift returned error code ${response.status}`)
    }
    return response.json()
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
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
      const fixedPromise = this.getFixedQuote(request, userSettings)
      const estimatePromise = this.getEstimate(request, userSettings)
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
      userSettings: Object | void
    ): Promise<EdgeSwapQuote> {
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
      safeFromCurrencyCode = safeFromCurrencyCode.toLowerCase()
      safeToCurrencyCode = safeToCurrencyCode.toLowerCase()
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

      const sendReply = await call({
        jsonrpc: '2.0',
        id: 2,
        method: 'createFixTransaction',
        params
      })
      checkReply(sendReply, request)
      const quoteInfo: FixedQuoteInfo = sendReply.result
      const spendInfoAmount = await request.fromWallet.denominationToNative(
        quoteInfo.amountExpectedFrom,
        // need to verify that this is okay
        // why use currencyCode from quoteInfo in the first place?
        request.fromCurrencyCode.toUpperCase()
      )

      const spendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: spendInfoAmount,
            publicAddress: quoteInfo.payinAddress,
            otherParams: {
              uniqueIdentifier: quoteInfo.payinExtraId
            }
          }
        ]
      }
      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)
      if (tx.otherParams == null) tx.otherParams = {}
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      const amountExpectedFromNative = await request.fromWallet.denominationToNative(
        sendReply.result.amountExpectedFrom,
        request.fromCurrencyCode
      )
      const amountExpectedToTo = await request.fromWallet.denominationToNative(
        sendReply.result.amountExpectedTo,
        request.toCurrencyCode
      )
      return makeSwapPluginQuote(
        request,
        amountExpectedFromNative,
        amountExpectedToTo,
        tx,
        toAddress,
        'sideshift',
        false,
        new Date(Date.now() + expirationFixedMs),
        quoteInfo.id
      )
    },

    async getEstimate(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapQuote> {
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
      safeFromCurrencyCode = safeFromCurrencyCode.toLowerCase()
      safeToCurrencyCode = safeToCurrencyCode.toLowerCase()
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

      // Check the minimum:
      const nativeMin = await request.fromWallet.denominationToNative(
        quoteReplies[0].result,
        request.fromCurrencyCode
      )
      if (lt(fromNativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }

      // Get the address:
      const sendReply = await call({
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
      })
      checkReply(sendReply, request)
      const quoteInfo: QuoteInfo = sendReply.result
      // Make the transaction:
      const spendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: quoteInfo.payinAddress,
            otherParams: {
              uniqueIdentifier: quoteInfo.payinExtraId
            }
          }
        ]
      }
      log('spendInfo', spendInfo)
      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)
      if (tx.otherParams == null) tx.otherParams = {}

      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'sideshift',
        true,
        new Date(Date.now() + expirationMs),
        quoteInfo.id
      )
    }
  }

  return out
}
