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
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  getCodes,
  InvalidCurrencyCodes,
  makeSwapPluginQuote
} from '../swap-helpers'
import { convertRequest } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'

const pluginId = 'changehero'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'ChangeHero',
  supportEmail: 'support@changehero.io'
}

const asInitOptions = asObject({
  apiKey: asString
})

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
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

const dontUseLegacy: { [cc: string]: boolean } = {
  DGB: true
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress != null && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
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
  ): Promise<EdgeSwapQuote> {
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet, request.fromCurrencyCode),
      getAddress(request.toWallet, request.toCurrencyCode)
    ])
    const { fromCurrencyCode, toCurrencyCode } = getCodes(request)

    // The chain codes are undocumented but ChangeHero uses Edge pluginIds for these values (confirmed via Slack)
    const fromMainnetCode = request.fromWallet.currencyInfo.pluginId
    const toMainnetCode = request.toWallet.currencyInfo.pluginId

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
      swapData: {
        orderUri: orderUri + quoteInfo.id,
        orderId: quoteInfo.id,
        isEstimate: false,
        payoutAddress: toAddress,
        payoutCurrencyCode: toCurrencyCode,
        payoutNativeAmount: amountExpectedToNative,
        payoutWalletId: request.toWallet.id,
        plugin: { ...swapInfo },
        refundAddress: fromAddress
      }
    }

    const order = {
      request,
      spendInfo,
      pluginId,
      expirationDate: new Date(Date.now() + expirationFixedMs)
    }

    return await makeSwapPluginQuote(order)
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
      return await getFixedQuote(request)
    }
  }

  return out
}
