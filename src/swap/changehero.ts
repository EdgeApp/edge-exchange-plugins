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
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  CurrencyCodeTranscriptionMap,
  getCodesWithTranscription,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../util/swapHelpers'
import { convertRequest, getAddress } from '../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from './types'

const pluginId = 'changehero'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'ChangeHero',
  supportEmail: 'support@changehero.io'
}

const asInitOptions = asObject({
  apiKey: asString
})

const MAINNET_CODE_TRANSCRIPTION: StringMap = {
  ethereum: 'ethereum',
  binancesmartchain: 'binance_smart_chain',
  solana: 'solana',
  algorand: 'algorand',
  avalanche: 'avalanche_(c-chain)',
  bitcoincash: 'bitcoin_cash',
  bitcoinsv: 'bitcoin_sv',
  bitcoin: 'bitcoin',
  tron: 'tron',
  polygon: 'polygon',
  dash: 'dash',
  digibyte: 'digibyte',
  dogecoin: 'doge',
  polkadot: 'polkadot',
  ethereumclassic: 'ethereum_classic',
  optimism: 'optimism',
  hedera: 'hedera',
  litecoin: 'litecoin',
  qtum: 'qtum',
  stellar: 'stellar',
  monero: 'monero',
  ripple: 'ripple',
  tezos: 'tezos',
  zcash: 'zcash'
}

const CURRENCY_CODE_TRANSCRIPTION: CurrencyCodeTranscriptionMap = {
  polygon: { 'USDC.e': 'USDCE' }
}

// See https://changehero.io/currencies for list of supported currencies
const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    optimism: ['VELO']
  },
  to: {
    zcash: ['ZEC'] // ChangeHero doesn't support sending to shielded addresses
  }
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

function checkReply(
  reply: { error?: { code?: number; message?: string } },
  request: EdgeSwapRequestPlugin
): void {
  if (reply.error != null) {
    if (
      reply.error.code === -32602 ||
      (reply.error.message?.includes('Invalid currency:') ?? false)
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    throw new Error('ChangeHero error: ' + JSON.stringify(reply.error))
  }
}

export function makeChangeHeroPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  async function call(json: any): Promise<any> {
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

  async function getFixedQuote(
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> {
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet),
      getAddress(request.toWallet)
    ])

    // Supported chains must be whitelisted
    if (
      MAINNET_CODE_TRANSCRIPTION[request.fromWallet.currencyInfo.pluginId] ==
        null ||
      MAINNET_CODE_TRANSCRIPTION[request.toWallet.currencyInfo.pluginId] == null
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodesWithTranscription(
      request,
      MAINNET_CODE_TRANSCRIPTION,
      CURRENCY_CODE_TRANSCRIPTION
    )

    const quoteAmount =
      request.quoteFor === 'from'
        ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            fromCurrencyCode
          )
        : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            toCurrencyCode
          )

    const fixRate = {
      jsonrpc: '2.0',
      id: 'one',
      method: 'getFixRate',
      params: {
        from: fromCurrencyCode,
        to: toCurrencyCode,
        chainFrom: fromMainnetCode,
        chainTo: toMainnetCode
      }
    }
    const fixedRateQuote = await call(fixRate)

    checkReply(fixedRateQuote, request)

    const [
      { id: responseId, maxFrom, maxTo, minFrom, minTo }
    ] = asGetFixRateReply(fixedRateQuote).result
    const maxFromNative = await request.fromWallet.denominationToNative(
      maxFrom,
      fromCurrencyCode
    )
    const maxToNative = await request.toWallet.denominationToNative(
      maxTo,
      toCurrencyCode
    )
    const minFromNative = await request.fromWallet.denominationToNative(
      minFrom,
      fromCurrencyCode
    )
    const minToNative = await request.toWallet.denominationToNative(
      minTo,
      toCurrencyCode
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
        throw new SwapAboveLimitError(swapInfo, maxToNative, 'to')
      }
      if (lt(quoteAmount, minTo)) {
        throw new SwapBelowLimitError(swapInfo, minToNative, 'to')
      }
    }

    const params =
      request.quoteFor === 'from'
        ? {
            amount: quoteAmount,
            from: fromCurrencyCode,
            to: toCurrencyCode,
            chainFrom: fromMainnetCode,
            chainTo: toMainnetCode,
            address: toAddress,
            extraId: null,
            refundAddress: fromAddress,
            refundExtraId: null,
            rateId: responseId
          }
        : {
            amountTo: quoteAmount,
            from: fromCurrencyCode,
            to: toCurrencyCode,
            chainFrom: fromMainnetCode,
            chainTo: toMainnetCode,
            address: toAddress,
            extraId: null,
            refundAddress: fromAddress,
            refundExtraId: null,
            rateId: responseId
          }
    const reply = {
      jsonrpc: '2.0',
      id: 2,
      method: 'createFixTransaction',
      params
    }

    const sendReply = await call(reply)

    // NOTE: Testing showed the undocumented `chainFrom` and `chainTo` fields in sendReply are present in the response but are null.
    // Tested with mainnet currency codes in addition to the pluginIds as detailed above.

    checkReply(sendReply, request)

    const quoteInfo = asCreateFixTransactionReply(sendReply).result
    const amountExpectedFromNative = await request.fromWallet.denominationToNative(
      `${quoteInfo.amountExpectedFrom.toString()}`,
      fromCurrencyCode
    )
    const amountExpectedToNative = await request.toWallet.denominationToNative(
      `${quoteInfo.amountExpectedTo.toString()}`,
      toCurrencyCode
    )

    const spendInfo: EdgeSpendInfo = {
      currencyCode: fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: amountExpectedFromNative,
          publicAddress: quoteInfo.payinAddress,
          uniqueIdentifier: quoteInfo.payinExtraId ?? undefined
        }
      ],
      networkFeeOption:
        request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
      savedAction: {
        type: 'swap',
        swapInfo,
        orderUri: orderUri + quoteInfo.id,
        orderId: quoteInfo.id,
        isEstimate: false,
        destAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: amountExpectedToNative
        },
        sourceAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: amountExpectedFromNative
        },
        payoutAddress: toAddress,
        payoutWalletId: request.toWallet.id,
        refundAddress: fromAddress
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: amountExpectedFromNative,
      expirationDate: new Date(Date.now() + expirationFixedMs)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      const newRequest = await getMaxSwappable(getFixedQuote, request)
      const swapOrder = await getFixedQuote(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
