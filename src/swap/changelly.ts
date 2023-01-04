import { lt } from 'biggystring'
import { asBoolean, asEither, asNull, asObject, asString } from 'cleaners'
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
import hashjs from 'hash.js'
import { base16 } from 'rfc4648'
import utf8Codec from 'utf8'

import {
  checkInvalidCodes,
  CurrencyCodeTranscriptionMap,
  getCodesWithTranscription,
  InvalidCurrencyCodes,
  makeSwapPluginQuote
} from '../swap-helpers'
import { convertRequest } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'

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

const MUST_USE_CURRENCY_PLUGIN_ID = 'piratechain'

// Invalid currency codes should *not* have transcribed codes
// because currency codes with transcribed versions are NOT invalid
const CURRENCY_CODE_TRANSCRIPTION: CurrencyCodeTranscriptionMap = {
  ethereum: {
    USDT: 'USDT20'
  },
  binancesmartchain: {
    BNB: 'BNBBSC'
  }
}

function hmacSha512(data: Uint8Array, key: Uint8Array): Uint8Array {
  // @ts-expect-error
  const hmac = hashjs.hmac(hashjs.sha512, key)
  // @ts-expect-error
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
const expirationMs = 1000 * 60
const expirationFixedMs = 1000 * 60
const asQuoteInfo = asObject({
  result: asObject({
    id: asString,
    apiExtraFee: asString,
    changellyFee: asString,
    payinExtraId: asEither(asString, asNull),
    payoutExtraId: asEither(asString, asNull),
    amountExpectedFrom: asString,
    amountExpectedTo: asString,
    status: asString,
    currencyFrom: asString,
    currencyTo: asString,
    amountTo: asString,
    payinAddress: asString,
    payoutAddress: asString,
    createdAt: asString
  })
})

const asFixedQuoteInfo = asObject({
  result: asObject({
    id: asString,
    amountExpectedFrom: asString,
    amountExpectedTo: asString,
    amountTo: asString,
    apiExtraFee: asString,
    changellyFee: asString,
    createdAt: asString,
    currencyFrom: asString,
    currencyTo: asString,
    kycRequired: asBoolean,
    payinAddress: asString,
    payinExtraId: asEither(asString, asNull),
    payoutAddress: asString,
    payoutExtraId: asEither(asString, asNull),
    refundAddress: asString,
    refundExtraId: asEither(asString, asNull),
    status: asString
  })
})

const asFixedRateQuote = asObject({
  result: asObject({
    id: asString
  })
})

const asQuoteReply = asObject({
  result: asString
})

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const { publicAddress } = await wallet.getReceiveAddress({ currencyCode })
  return publicAddress
}

function checkReply(
  reply: { error?: { code?: number; message?: string } },
  request: EdgeSwapRequestPlugin
): void {
  if (reply.error != null) {
    if (
      reply.error.code === -32602 ||
      (reply.error.message?.includes('Invalid currency:') ?? false)
    ) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }
    throw new Error('ChangeHero error: ' + JSON.stringify(reply.error))
  }
}

export function makeChangellyPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const { fetchCors = io.fetch } = io

  if (initOptions.apiKey == null || initOptions.secret == null) {
    throw new Error('No Changelly apiKey or secret provided.')
  }
  const { apiKey } = initOptions
  const secret = parseUtf8(initOptions.secret)

  async function call(json: any, promoCode?: string): Promise<Object> {
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
    return await response.json()
  }

  async function getFixedQuote(
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<EdgeSwapQuote> {
    const { promoCode } = opts
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])
    const quoteAmount = await request.fromWallet.nativeToDenomination(
      request.nativeAmount,
      request.fromCurrencyCode
    )

    const { fromCurrencyCode, toCurrencyCode } = getCodesWithTranscription(
      request,
      {},
      CURRENCY_CODE_TRANSCRIPTION
    )

    const safeFromCurrencyCode = fromCurrencyCode.toLowerCase()
    const safeToCurrencyCode = toCurrencyCode.toLowerCase()

    const fixedRateQuoteResponse = await call({
      jsonrpc: '2.0',
      id: 'one',
      method: 'getFixRateForAmount',
      params: {
        from: safeFromCurrencyCode,
        to: safeToCurrencyCode,
        amountFrom: quoteAmount
      }
    })
    const fixedRateQuote = asFixedRateQuote(fixedRateQuoteResponse)
    const params = {
      amount: quoteAmount,
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
    const quoteInfo = asFixedQuoteInfo(sendReply).result
    const spendInfoAmount = await request.fromWallet.denominationToNative(
      quoteInfo.amountExpectedFrom,
      // need to verify that this is okay
      // why use currencyCode from quoteInfo in the first place?
      request.fromCurrencyCode.toUpperCase()
    )

    const amountExpectedFromNative = await request.fromWallet.denominationToNative(
      quoteInfo.amountExpectedFrom,
      request.fromCurrencyCode
    )
    const amountExpectedToTo = await request.toWallet.denominationToNative(
      quoteInfo.amountExpectedTo,
      request.toCurrencyCode
    )

    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: spendInfoAmount,
          publicAddress: quoteInfo.payinAddress,
          uniqueIdentifier: quoteInfo.payinExtraId ?? undefined
        }
      ],
      networkFeeOption:
        request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
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
  }

  async function getEstimate(
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<EdgeSwapQuote> {
    const { promoCode } = opts
    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])

    // Convert the native amount to a denomination:
    const quoteAmount = await request.fromWallet.nativeToDenomination(
      request.nativeAmount,
      request.fromCurrencyCode
    )

    const { fromCurrencyCode, toCurrencyCode } = getCodesWithTranscription(
      request,
      {},
      CURRENCY_CODE_TRANSCRIPTION
    )

    const safeFromCurrencyCode = fromCurrencyCode.toLowerCase()
    const safeToCurrencyCode = toCurrencyCode.toLowerCase()

    // Swap the currencies if we need a reverse quote:
    const quoteParams = {
      from: safeFromCurrencyCode,
      to: safeToCurrencyCode,
      amount: quoteAmount
    }

    // Get the estimate from the server:
    const [minAmountResponse, exchangeAmountResponse] = await Promise.all([
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
    checkReply(minAmountResponse, request)
    const minAmount = asQuoteReply(minAmountResponse).result

    // Check the minimum:
    const nativeMin = await request.fromWallet.denominationToNative(
      minAmount,
      request.fromCurrencyCode
    )
    if (lt(request.nativeAmount, nativeMin)) {
      throw new SwapBelowLimitError(swapInfo, nativeMin)
    }

    checkReply(exchangeAmountResponse, request)

    // Calculate the amounts:
    const fromAmount = quoteAmount
    const fromNativeAmount = request.nativeAmount

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
    const quoteInfo = asQuoteInfo(sendReply).result

    const toNativeAmount = await request.toWallet.denominationToNative(
      quoteInfo.amountExpectedTo,
      request.toCurrencyCode
    )

    // Make the transaction:
    const spendInfo: EdgeSpendInfo = {
      currencyCode: request.fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteInfo.payinAddress,
          uniqueIdentifier: quoteInfo.payinExtraId ?? undefined
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

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
      // Only allow FROM quotes
      if (request.quoteFor !== 'from') {
        throw new SwapCurrencyError(swapInfo, req)
      }

      if (
        request.fromWallet.currencyInfo.pluginId !==
          MUST_USE_CURRENCY_PLUGIN_ID &&
        request.toWallet.currencyInfo.pluginId !== MUST_USE_CURRENCY_PLUGIN_ID
      ) {
        throw new SwapCurrencyError(swapInfo, req)
      }

      // Hack to make lint happy so we don't have to comment out getFixedQuote
      console.log(getFixedQuote.name)
      // const fixedPromise = getFixedQuote(request, opts)
      const estimatePromise = getEstimate(request, opts)
      // try {
      //   const fixedResult = await fixedPromise
      //   return fixedResult
      // } catch (e) {
      const estimateResult = await estimatePromise
      return estimateResult
      // }
    }
  }

  return out
}
