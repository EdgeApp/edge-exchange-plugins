// @flow

import { asNumber, asObject, asOptional, asString } from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'

import { makeSwapPluginQuote, safeCurrencyCodes } from '../swap-helpers.js'

const CURRENCY_CODE_TRANSCRIPTION = {
  ethereum: {
    USDT: 'USDT20'
  },
  avalanche: {
    AVAX: 'AVAXC'
  },
  binancesmartchain: {
    BNB: 'BNBBSC'
  },
  polygon: {
    MATIC: 'POLYGON'
  }
}

const pluginId = 'changehero'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'ChangeHero',
  supportEmail: 'support@changehero.io'
}

const orderUri = 'https://changehero.io/transaction/'
const uri = 'https://api.changehero.io/v2'
const expirationFixedMs = 1000 * 60 * 5

type FixedQuoteInfo = {
  id: string,
  amountExpectedFrom: string,
  amountExpectedTo: number,
  amountTo: number,
  createdAt: string,
  currencyFrom: string,
  currencyTo: string,
  payinAddress: string,
  payinExtraId: string | null,
  payoutAddress: string,
  payoutExtraId: string | null,
  refundAddress: string,
  refundExtraId: string | null,
  status: string
}

const asQuoteInfo = asObject({
  result: asObject({
    id: asString,
    status: asString,
    amountExpectedFrom: asString,
    amountExpectedTo: asNumber,
    payinAddress: asString,
    payinExtraId: asOptional(asString),
    currencyFrom: asString,
    currencyTo: asString,
    payoutAddress: asString,
    payoutExtraId: asOptional(asString)
  })
})

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
    throw new Error('ChangeHero error: ' + JSON.stringify(reply.error))
  }
}

function checkEthOnly(request: EdgeSwapRequest) {
  const currencyFromWallet = request.fromWallet.currencyInfo.currencyCode
  const currencyToWallet = request.toWallet.currencyInfo.currencyCode

  if (
    currencyFromWallet !== request.fromCurrencyCode &&
    currencyFromWallet !== 'ETH'
  ) {
    throw new Error('Currency not supported')
  } else if (
    currencyToWallet !== request.toCurrencyCode &&
    currencyToWallet !== 'ETH'
  ) {
    throw new Error('Currency not supported')
  }
}

export function makeChangeHeroPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const { fetchCors = io.fetch } = io

  if (initOptions.apiKey == null) {
    throw new Error('No ChangeHero apiKey or secret provided.')
  }
  const { apiKey } = initOptions

  async function call(json: any) {
    const body = JSON.stringify(json)

    const headers = {
      'Content-Type': 'application/json',
      'api-key': apiKey
    }
    const response = await fetchCors(uri, { method: 'POST', body, headers })

    if (!response.ok) {
      throw new Error(`ChangeHero returned error code ${response.status}`)
    }
    return response.json()
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapQuote> {
      checkEthOnly(request)
      return this.getFixedQuote(request, userSettings)
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

      const { safeFromCurrencyCode, safeToCurrencyCode } = safeCurrencyCodes(
        CURRENCY_CODE_TRANSCRIPTION,
        request
      )

      const fixedRateQuote = await call({
        jsonrpc: '2.0',
        id: 'one',
        method: 'getFixRate',
        params: {
          from: safeFromCurrencyCode,
          to: safeToCurrencyCode
        }
      })

      const [{ id: responseId }] = fixedRateQuote.result
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
              rateId: responseId
            }
          : {
              amountTo: quoteAmount,
              from: safeFromCurrencyCode,
              to: safeToCurrencyCode,
              address: toAddress,
              extraId: null,
              refundAddress: fromAddress,
              refundExtraId: null,
              rateId: responseId
            }

      const sendReply = await call({
        jsonrpc: '2.0',
        id: 2,
        method: 'createFixTransaction',
        params
      })
      checkReply(sendReply, request)
      asQuoteInfo(sendReply)
      const quoteInfo: FixedQuoteInfo = sendReply.result
      const spendInfoAmount = await request.fromWallet.denominationToNative(
        `${quoteInfo.amountExpectedFrom}`,
        request.fromCurrencyCode.toUpperCase()
      )

      const amountExpectedFromNative = await request.fromWallet.denominationToNative(
        `${sendReply.result.amountExpectedFrom}`,
        request.fromCurrencyCode
      )
      const amountExpectedToTo = await request.toWallet.denominationToNative(
        `${sendReply.result.amountExpectedTo}`,
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
          orderUri: orderUri + quoteInfo.id,
          orderId: quoteInfo.id,
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
        'changehero',
        false,
        new Date(Date.now() + expirationFixedMs),
        quoteInfo.id
      )
    }
  }

  return out
}
