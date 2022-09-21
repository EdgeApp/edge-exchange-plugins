// @flow

import {
  type ObjectCleaner,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import { type EdgeFetchFunction } from 'edge-core-js'
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

import {
  type InvalidCurrencyCodes,
  checkEthTokensOnly,
  checkInvalidCodes,
  makeSwapPluginQuote,
  safeCurrencyCodes
} from '../swap-helpers.js'

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    ethereum: ['BNB', 'FTM', 'MATIC', 'KNC'],
    avalanche: 'allTokens',
    binancesmartchain: 'allTokens',
    polygon: 'allCodes',
    celo: 'allTokens',
    fantom: 'allCodes'
  },
  to: {
    ethereum: ['BNB', 'FTM', 'MATIC', 'KNC'],
    avalanche: 'allTokens',
    binancesmartchain: 'allTokens',
    polygon: 'allCodes',
    celo: 'allTokens',
    fantom: 'allCodes',
    zcash: ['ZEC']
  }
}

// Invalid currency codes should *not* have transcribed codes
// because currency codes with transcribed versions are NOT invalid
const CURRENCY_CODE_TRANSCRIPTION = {
  ethereum: {
    USDT: 'USDT20'
  },
  binancesmartchain: {
    BNB: 'BNBBSC'
  }
}

const pluginId = 'criptointercambio'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Criptointercambio',
  supportEmail: 'support@criptointercambio.com'
}
const orderUri = 'https://criptointercambio.com/transaction/'
const uri = 'https://api2.criptointercambio.com'
const expirationFixedMs = 1000 * 60 * 5
const asRequestOptions = asObject({
  apiKey: asString,
  secret: asString
})
type RequestOptions = $Call<typeof asRequestOptions>
const asCreateFixedTransaction = asObject({
  id: asString,
  amountExpectedFrom: asString,
  amountExpectedTo: asString,
  amountTo: asNumber,
  apiExtraFee: asString,
  createdAt: asString,
  currencyFrom: asString,
  currencyTo: asString,
  kycRequired: asBoolean,
  payinAddress: asString,
  payinExtraId: asOptional(asString),
  payoutAddress: asString,
  payoutExtraId: asOptional(asString),
  refundAddress: asString,
  refundExtraId: asOptional(asString),
  status: asString
})
const asGetFixRateForAmount = asObject({
  id: asString
})
const dontUseLegacy = {
  DGB: true
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

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

type FetcherType = (json: any, promoCode?: string) => Promise<any>

function makeFetcher(
  fetch: EdgeFetchFunction,
  options: RequestOptions
): FetcherType {
  return async function (json: any, promoCode?: string) {
    const body = JSON.stringify(json)
    const sign = base16
      .stringify(hmacSha512(parseUtf8(body), parseUtf8(options.secret)))
      .toLowerCase()

    const headers: { [header: string]: string } = {
      'Content-Type': 'application/json',
      'api-key': options.apiKey,
      sign
    }
    if (promoCode != null) headers['X-Promo-Code'] = promoCode
    const response = await fetch(uri, { method: 'POST', body, headers })

    if (!response.ok) {
      throw new Error(
        `Criptointercambio returned error code ${response.status}`
      )
    }
    return response.json()
  }
}

async function wrapCleanerRequest(
  cleaner: ObjectCleaner<any>,
  fetcher: FetcherType,
  request: EdgeSwapRequest,
  method: string,
  params: any
) {
  const { promoCode, ...restParams } = params
  const response = await fetcher(
    {
      jsonrpc: '2.0',
      id: 'one',
      method,
      restParams
    },
    promoCode
  )
  await checkReply(response, request)
  return cleaner(response.result)
}

async function checkReply(reply: Object, request: EdgeSwapRequest) {
  const { fromCurrencyCode, fromWallet } = request
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
    if (
      reply.error.code === -32600 ||
      /Invalid amout:/.test(reply.error.message)
    ) {
      const matcher = reply.error.code.match(/([\d\\.]+)$/gim)
      const minmaxAmount =
        matcher.length > 0
          ? await fromWallet.denominationToNative(matcher[0], fromCurrencyCode)
          : ''
      if (/minimal amount/.test(reply.error.message)) {
        throw new SwapBelowLimitError(swapInfo, minmaxAmount)
      } else {
        throw new SwapAboveLimitError(swapInfo, minmaxAmount)
      }
    }

    throw new Error('Criptointercambio error: ' + JSON.stringify(reply.error))
  }
}

export function makeCriptointercambioPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const { fetchCors = io.fetch } = io

  if (initOptions.apiKey == null || initOptions.secret == null) {
    throw new Error('No Criptointercambio apiKey or secret provided.')
  }
  const fetcher = makeFetcher(fetchCors, asRequestOptions(initOptions))

  return {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
      checkEthTokensOnly(swapInfo, request)

      const fixedPromise = this.getFixedQuote(request, userSettings, opts)
      // FIXME: Estimated swaps are temporarily disabled
      const fixedResult = await fixedPromise
      return fixedResult
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

      const { safeFromCurrencyCode, safeToCurrencyCode } = safeCurrencyCodes(
        CURRENCY_CODE_TRANSCRIPTION,
        request
      )

      const fixedRate = await wrapCleanerRequest(
        asGetFixRateForAmount,
        fetcher,
        request,
        'getFixRateForAmount',
        {
          from: safeFromCurrencyCode,
          to: safeToCurrencyCode,
          [request.quoteFor === 'from' ? 'amountFrom' : 'amountTo']: quoteAmount
        }
      )

      const fixedTx = await wrapCleanerRequest(
        asCreateFixedTransaction,
        fetcher,
        request,
        'createFixTransaction',
        {
          [request.quoteFor === 'from' ? 'amount' : 'amountTo']: quoteAmount,
          from: safeFromCurrencyCode,
          to: safeToCurrencyCode,
          address: toAddress,
          extraId: null,
          refundAddress: fromAddress,
          refundExtraId: null,
          rateId: fixedRate.result.id,
          //
          promoCode
        }
      )

      const amountExpectedFromNative = await request.fromWallet.denominationToNative(
        fixedTx.amountExpectedFrom,
        request.fromCurrencyCode
      )
      const amountExpectedToNative = await request.toWallet.denominationToNative(
        fixedTx.amountExpectedTo,
        request.toCurrencyCode
      )

      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: amountExpectedFromNative,
            publicAddress: fixedTx.payinAddress,
            uniqueIdentifier: fixedTx.payinExtraId || undefined
          }
        ],
        networkFeeOption:
          request.fromCurrencyCode === 'BTC' ? 'high' : 'standard',
        swapData: {
          orderId: fixedTx.id,
          orderUri: orderUri + fixedTx.id,
          isEstimate: false,
          payoutAddress: toAddress,
          payoutCurrencyCode: request.toCurrencyCode,
          payoutNativeAmount: amountExpectedToNative,
          payoutWalletId: request.toWallet.id,
          plugin: { ...swapInfo },
          refundAddress: fromAddress
        }
      }
      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)

      return makeSwapPluginQuote(
        request,
        amountExpectedFromNative,
        amountExpectedToNative,
        tx,
        toAddress,
        pluginId,
        false,
        new Date(Date.now() + expirationFixedMs),
        fixedTx.id
      )
    }
  }
}
