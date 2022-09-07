import { gt, lt } from 'biggystring'
import {
  asArray,
  asEither,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  safeCurrencyCodes
} from '../swap-helpers'

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

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    ethereum: ['MATIC', 'AVAX', 'BNB', 'FTM', 'CELO'],
    avalanche: 'allCodes',
    binancesmartchain: 'allCodes',
    celo: 'allCodes',
    fantom: 'allCodes',
    polygon: 'allCodes'
  },
  to: {
    ethereum: ['MATIC', 'AVAX', 'BNB', 'FTM', 'CELO'],
    avalanche: 'allCodes',
    binancesmartchain: 'allCodes',
    celo: 'allCodes',
    fantom: 'allCodes',
    polygon: 'allCodes'
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
const expirationFixedMs = 1000 * 60

const asGetFixRateReply = asObject({
  result: asArray(
    asObject({
      id: asString,
      maxFrom: asString,
      maxTo: asString,
      minFrom: asString,
      minTo: asString
      // from: asString,
      // to: asString,
    })
  )
})

const asCreateFixTransactionReply = asObject({
  result: asObject({
    id: asString,
    status: asString,
    amountExpectedFrom: asEither(asString, asNumber),
    amountExpectedTo: asEither(asString, asNumber),
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
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode,
      request.toCurrencyCode
    )
  } else if (
    currencyToWallet !== request.toCurrencyCode &&
    currencyToWallet !== 'ETH'
  ) {
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode,
      request.toCurrencyCode
    )
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
    return await response.json()
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | undefined
    ): Promise<EdgeSwapQuote> {
      checkEthOnly(request)
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      return this.getFixedQuote(request, userSettings)
    },
    async getFixedQuote(
      request: EdgeSwapRequest,
      userSettings: Object | undefined
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

      const [
        { id: responseId, maxFrom, maxTo, minFrom, minTo }
      ] = asGetFixRateReply(fixedRateQuote).result
      const maxFromNative = await request.fromWallet.denominationToNative(
        maxFrom,
        request.fromCurrencyCode
      )
      const maxToNative = await request.toWallet.denominationToNative(
        maxTo,
        request.toCurrencyCode
      )
      const minFromNative = await request.fromWallet.denominationToNative(
        minFrom,
        request.fromCurrencyCode
      )
      const minToNative = await request.toWallet.denominationToNative(
        minTo,
        request.toCurrencyCode
      )

      if (request.quoteFor === 'from') {
        if (gt(quoteAmount, maxFrom)) {
          throw new SwapAboveLimitError(swapInfo, maxFromNative)
        }
        if (lt(quoteAmount, minFrom)) {
          throw new SwapBelowLimitError(swapInfo, minFromNative)
        }
      } else {
        if (gt(quoteAmount, maxTo)) {
          throw new SwapAboveLimitError(swapInfo, maxToNative)
        }
        if (lt(quoteAmount, minTo)) {
          throw new SwapBelowLimitError(swapInfo, minToNative)
        }
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

      const quoteInfo = asCreateFixTransactionReply(sendReply).result
      const amountExpectedFromNative = await request.fromWallet.denominationToNative(
        `${quoteInfo.amountExpectedFrom.toString()}`,
        request.fromCurrencyCode
      )
      const amountExpectedToNative = await request.toWallet.denominationToNative(
        `${quoteInfo.amountExpectedTo.toString()}`,
        request.toCurrencyCode
      )

      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: amountExpectedFromNative,
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
        quoteInfo.id
      )
    }
  }

  return out
}
