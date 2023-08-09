import { asNumber, asObject, asOptional, asString } from 'cleaners'
import { EdgeFetchFunction } from 'edge-core-js'
import { EdgeSwapQuote } from 'edge-core-js/src/types/types'
import {
  EdgeCorePluginOptions,
  EdgeSwapPlugin,
  JsonObject,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'
import { KEYUTIL, KJUR } from 'jsrsasign'

import {
  checkEthTokensOnly,
  checkInvalidCodes,
  getCodes,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../swap-helpers'
import { convertRequest, getAddress } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'
const pluginId = 'criptointercambio'
const uri = 'https://api2.criptointercambio.com/v2'
const swapInfo = {
  pluginId,
  displayName: 'Criptointercambio',
  supportEmail: 'support@criptointercambio.com'
}

interface Body<T> {
  jsonrpc: '2.0'
  id: string
  method: string
  params: T
}

interface Result<T> {
  result: T
}

interface Error {
  error: {
    code: number
    message: string
  }
}

interface EstimationRequest {
  from: string
  to: string
  amountFrom: string
}

interface EstimationResponse {
  id: string
  result: string
  networkFee: string
  from: string
  to: string
  max: string
  maxFrom: string
  maxTo: string
  min: string
  minFrom: string
  minTo: string
  amountFrom: string
  amountTo: string
  expiredAt: number
}

interface TransactionRequest {
  from: string
  to: string
  address: string
  extraId?: string
  amountFrom: string
  rateId: string
  refundAddress: string
  refundExtraId?: string
}

interface TransactionResponse {
  id: string
  trackUrl: string
  type: string
  status: string
  payTill: string
  currencyFrom: string
  currencyTo: string
  payinExtraId?: string
  payoutExtraId?: string
  refundAddress: string
  amountExpectedFrom: string
  amountExpectedTo: string
  payinAddress: string
  payoutAddress: string
  createdAt: number
}

type Caller<T, R = any> = (
  json: Body<T>,
  promoCode?: string
) => Promise<Result<R> | Error>

const asRequestOptions = asObject({
  apiKey: asString,
  secret: asString
})

const asEstimationReply = asObject<Result<Pick<EstimationResponse, 'id'>>>({
  result: asObject<Pick<EstimationResponse, 'id'>>({
    id: asString
  })
})

const asTransactionReply = asObject<Result<TransactionResponse>>({
  result: asObject({
    id: asString,
    trackUrl: asString,
    type: asString,
    status: asString,
    payTill: asString,
    currencyFrom: asString,
    currencyTo: asString,
    payinExtraId: asOptional(asString),
    payoutExtraId: asOptional(asString),
    refundAddress: asString,
    amountExpectedFrom: asString,
    amountExpectedTo: asString,
    payinAddress: asString,
    payoutAddress: asString,
    createdAt: asNumber
  })
})

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

async function checkReply(
  reply: Result<any> | Error,
  request: EdgeSwapRequestPlugin
): Promise<void> {
  if ('error' in reply) {
    if (
      reply.error.code === -32602 ||
      reply.error.message.includes('Invalid currency:')
    ) {
      throw new SwapCurrencyError(
        swapInfo,
        request.fromCurrencyCode,
        request.toCurrencyCode
      )
    }
    if (
      reply.error.code === -32600 ||
      reply.error.message.includes('Invalid amout:')
    ) {
      const matcher = reply.error.message.match(/([\d\\.]+)$/gim)
      const minmaxAmount =
        matcher !== null && matcher.length > 0
          ? await request.fromWallet.denominationToNative(
              matcher[0],
              request.fromCurrencyCode
            )
          : ''
      if (reply.error.message.includes('minimal amount')) {
        throw new SwapBelowLimitError(swapInfo, minmaxAmount)
      } else {
        throw new SwapAboveLimitError(swapInfo, minmaxAmount)
      }
    }

    throw new Error('Criptointercambio error: ' + JSON.stringify(reply.error))
  }
}

function getSignature(data: string, key: string): string {
  const signature = new KJUR.crypto.Signature({ alg: 'SHA256withRSA' })
  const privateKey = KEYUTIL.getKeyFromPlainPrivatePKCS8Hex(key)
  signature.init(privateKey)
  signature.updateString(data)
  const sign = signature.sign()

  return Buffer.from(sign, 'hex').toString('base64')
}

function makeCaller(
  apiKey: string,
  secret: string,
  fetchCors: EdgeFetchFunction
): Caller<any> {
  return async function <T, R = any>(
    json: Body<T>,
    promoCode?: string
  ): Promise<Result<R> | Error> {
    const body = JSON.stringify(json)
    const sign = getSignature(body, secret)

    const headers: { [header: string]: string } = {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-Signature': sign
    }
    if (promoCode != null) headers['X-Promo-Code'] = promoCode
    const response = await fetchCors(uri, { method: 'POST', body, headers })

    if (!response.ok) {
      throw new Error(
        `Criptointercambio returned error code ${response.status}`
      )
    }

    const result = await response.json()
    return result as Result<R> | Error
  }
}

async function fetchFixedQuote(
  caller: Caller<any>,
  request: EdgeSwapRequestPlugin,
  userSettings: JsonObject | undefined,
  opts: { promoCode?: string }
): Promise<SwapOrder> {
  const { promoCode } = opts
  const [fromAddress, toAddress] = await Promise.all([
    getAddress(request.fromWallet),
    getAddress(request.toWallet)
  ])
  const { fromCurrencyCode, toCurrencyCode } = getCodes(request)

  const quoteAmount = await request.fromWallet.nativeToDenomination(
    request.nativeAmount,
    request.fromCurrencyCode
  )

  const estimateResponse = await (caller as Caller<
    EstimationRequest,
    EstimationResponse
  >)(
    {
      jsonrpc: '2.0',
      id: 'one',
      method: 'getFixRateForAmount',
      params: {
        from: fromCurrencyCode,
        to: toCurrencyCode,
        amountFrom: quoteAmount
      }
    },
    promoCode
  )

  await checkReply(estimateResponse, request)
  const { id: estimationId } = asEstimationReply(estimateResponse).result

  const transactionResponse = await (caller as Caller<
    TransactionRequest,
    TransactionResponse
  >)({
    jsonrpc: '2.0',
    id: 'one',
    method: 'createFixTransaction',
    params: {
      from: fromCurrencyCode,
      to: toCurrencyCode,
      amountFrom: quoteAmount,
      rateId: estimationId,
      address: toAddress,
      refundAddress: fromAddress
    }
  })

  await checkReply(transactionResponse, request)
  const {
    id: transactionId,
    trackUrl,
    amountExpectedTo,
    amountExpectedFrom,
    payTill,
    payinAddress,
    payinExtraId
  } = asTransactionReply(transactionResponse).result

  return {
    request,
    swapInfo,
    fromNativeAmount: amountExpectedFrom,
    expirationDate: new Date(payTill),
    spendInfo: {
      currencyCode: fromCurrencyCode,
      spendTargets: [
        {
          nativeAmount: amountExpectedFrom,
          publicAddress: payinAddress,
          uniqueIdentifier: payinExtraId
        }
      ],
      networkFeeOption: 'standard',
      swapData: {
        orderUri: trackUrl,
        orderId: transactionId,
        isEstimate: false,
        payoutAddress: toAddress,
        payoutCurrencyCode: toCurrencyCode,
        payoutNativeAmount: amountExpectedTo,
        payoutWalletId: request.toWallet.id,
        plugin: swapInfo,
        refundAddress: fromAddress
      }
    }
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
  const { apiKey, secret } = asRequestOptions(initOptions)

  const caller = makeCaller(apiKey, secret, fetchCors)

  return {
    swapInfo,
    fetchSwapQuote: async (req, userSettings, opts): Promise<EdgeSwapQuote> => {
      const request = convertRequest(req)

      if (['max', 'to'].includes(request.quoteFor)) {
        throw new Error(
          'Criptointercambio does not support `to` and `max` quotes at this time'
        )
      }

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
      checkEthTokensOnly(swapInfo, request)

      const order = await fetchFixedQuote(caller, request, userSettings, opts)

      return await makeSwapPluginQuote(order)
    }
  }
}
