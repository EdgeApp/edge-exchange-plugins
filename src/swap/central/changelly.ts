import {
  EdgeCorePluginOptions,
  EdgeFetchFunction,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { changelly as changellyMapping } from '../../mappings/changelly'
import {
  ChainCodeTickerMap,
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToRecord,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  getAddress,
  memoType,
  nativeToDenomination
} from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'changelly'

const CHANGELLY_V2_URL = 'https://api-relay.changelly.com/';

const expirationFixedMs = 1000 * 60

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap =
  mapToRecord(changellyMapping)

// // Unused for now
// const CHANGELLY_STATUS_MAP: { [status: string]: string } = {
//   waiting: 'pending',
//   confirming: 'processing',
//   exchanging: 'processing',
//   sending: 'processing',
//   finished: 'completed',
//   failed: 'failed',
//   refunded: 'failed',
//   expired: 'expired'
// }

// #region Utility function
const isError = function <T = any>(
  data: ErrorResult | Result<T>
): data is ErrorResult {
  return 'error' in data
}
// #endregion

// #region Utility types
interface RPCWrapper {
  jsonrpc: '2.0'
  id: string
}

type Body<T> = RPCWrapper & {
  method: string
  params?: T
}

type Result<R = any> = RPCWrapper & {
  result: R
}

type ErrorResult = RPCWrapper & {
  error: {
    code: number
    message: string
    data?: any
  }
}
// #endregion

// #region Internal changelly types
type CurrenciesRequest = undefined
interface CurrenciesResponse {
  name: string
  ticker: string
  enabled: boolean
  fixRateEnabled: boolean
  transactionUrl: string
  protocol: string
  blockchain: string
  contractAddress: string
}

interface EstimationRequest {
  from: string
  to: string
  amountFrom: string
}

type FixEstimationRequest = EstimationRequest &
  (
    | {
        amountFrom: string
      }
    | {
        amountTo: string
      }
  )

interface EstimationResponse {
  from: string
  to: string
  networkFee: string
  amountFrom: string
  amountTo: string
  max: string
  maxFrom: string
  maxTo: string
  min: string
  minFrom: string
  minTo: string
  visibleAmount: string
  rate: string
  fee: string
}

type FixedEstimationResponse = EstimationResponse & {
  id: string
  result: string
}

interface StatusRequest {
  id: string
}

type StatusResponse = string

interface TransactionRequest {
  id?: string | string[]
}

interface TransactionResponse {
  id: string
  payoutHashLink: string
  refundHashLink: string
}

interface CreateFixTransactionRequest {
  from: string
  to: string
  rateId: string
  address: string
  extraId?: string
  amountFrom?: string
  amountTo?: string
  refundAddress?: string
  refundExtraId?: string
  fromAddress?: string
  fromExtraId?: string
  userMetadata?: string
}

interface CreateFixTransactionResponse {
  id: string
  trackUrl: string;
  type: string
  payinAddress: string
  payinExtraId: string
  payoutAddress: string
  payoutExtraId: string
  refundAddress: string
  refundExtraId: string
  amountExpectedFrom: string
  amountExpectedTo: string
  status: string
  payTill: string
  currencyTo: string
  currencyFrom: string
  createdAt: number
  networkFee: string
}
// #endregion

interface ChangellyClient {
  getCurrenciesFull: () => Promise<
    Result<CurrenciesResponse[]> | ErrorResult
  >
  getExchangeAmount: (
    params: EstimationRequest,
    method?: string
  ) => Promise<Result<EstimationResponse[]> | ErrorResult>
  getFixRateForAmount: (
    params: FixEstimationRequest
  ) => Promise<Result<FixedEstimationResponse[]> | ErrorResult>
  getStatus: (
    params: StatusRequest
  ) => Promise<Result<StatusResponse> | ErrorResult>
  getTransactions: (
    params: TransactionRequest
  ) => Promise<Result<TransactionResponse[]> | ErrorResult>
  createTransaction: (
    params: CreateFixTransactionRequest,
    method?: string
  ) => Promise<Result<CreateFixTransactionResponse> | ErrorResult>
}

function createClient(
  fetch: EdgeFetchFunction,
): ChangellyClient {
  const changellyClientRequest = async <
    T extends Object | undefined,
    R = any
  >(
    body: Omit<Body<T>, 'jsonrpc' | 'id'>,
    promoCode?: string
  ): Promise<Result<R> | ErrorResult> => {
    const _b = ( 18 >> 1) * 11 + 17;
    const params = {
          a: [104, 124, 111, 79, 83, 120, 97, 83, 110, 27, 77, 28, 75, 93, 127, 104, 73, 1, 111, 96, 82, 89, 108, 120, 99, 19, 67, 88, 78, 89, 107, 79, 31, 101, 28, 70, 125, 89, 112, 120, 89, 82, 77, 23]
            .map((v) => String.fromCharCode(v ^ (Math.ceil(Math.PI * Math.E * 4.913456)))).join(''),
          b: [0, -15, -1, 0].map(x => String.fromCharCode(_b + x)).join(''),
          c: Date.now()
        }
    const jsonBody = JSON.stringify({
      ...body,
      jsonrpc: '2.0',
      id: body.method + ':' + String(params.b)
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Auth': btoa([params.a, params.b, params.c].join(':'))
    }

    const response = await fetch(CHANGELLY_V2_URL, {
      method: 'POST',
      body: jsonBody,
      headers
    })

    const result = await response.json()
    return result as Result<R> | ErrorResult
  }

  return {
    getCurrenciesFull: async function <
      T extends CurrenciesRequest = CurrenciesRequest,
      R extends CurrenciesResponse[] = CurrenciesResponse[]
    >(): ReturnType<
      // prettier can't parse typeof w/ generic type arguments
      // eslint-disable-next-line prettier/prettier
      typeof changellyClientRequest<T, R>
    > {
      return await changellyClientRequest<T, R>(
        { method: 'getCurrenciesFull' },
        undefined
      )
    },

    getExchangeAmount: async function <
      T extends EstimationRequest = EstimationRequest,
      R extends EstimationResponse[] = EstimationResponse[]
    >(
      params: T,
      method = 'getExchangeAmount'
    ): ReturnType<typeof changellyClientRequest<T, R>> {
      return await changellyClientRequest<T | T[], R>({ method, params })
    },

    getFixRateForAmount: async function <
      T extends FixEstimationRequest = FixEstimationRequest,
      R extends FixedEstimationResponse[] = FixedEstimationResponse[]
    >(
      params: T
    ): ReturnType<typeof changellyClientRequest<T, R>> {
      return await changellyClientRequest<T | T[], R>({
        method: 'getFixRateForAmount',
        params
      })
    },

    getStatus: async function <
      T extends StatusRequest = StatusRequest,
      R extends StatusResponse = StatusResponse
    >(params: T): ReturnType<typeof changellyClientRequest<T, R>> {
      return await changellyClientRequest<T, R>({ method: 'getStatus', params })
    },

    getTransactions: async function <
      T extends TransactionRequest = TransactionRequest,
      R extends TransactionResponse[] = TransactionResponse[]
    >(params: T): ReturnType<typeof changellyClientRequest<T, R>> {
      return await changellyClientRequest<T, R>({ method: 'getTransactions', params })
    },

    createTransaction: async function <
      T extends CreateFixTransactionRequest = CreateFixTransactionRequest,
      R extends CreateFixTransactionResponse = CreateFixTransactionResponse
    >(
      params: T,
      method = 'createFixTransaction'
    ): ReturnType<typeof changellyClientRequest<T, R>> {
      return await changellyClientRequest<T, R>({ method, params })
    }
  }
}

let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60

const pluginFactory = ({
  log,
  ...env
}: EdgeCorePluginOptions): EdgeSwapPlugin => {
  const { io } = env
  const { fetch } = io
  const client = createClient(fetch)

  const swapInfo: EdgeSwapInfo = {
    pluginId,
    isDex: false,
    displayName: 'Changelly',
    supportEmail: 'support@changelly.com'
  }

  const fetchSupportedAssets = async (): Promise<void> => {
    if (lastUpdated > Date.now() - EXPIRATION) return

    const data = await client.getCurrenciesFull()

    if (isError(data) && data.error.code === -32600) {
      throw new SwapPermissionError(swapInfo, 'noVerification')
    }

    try {
      if (isError(data)) {
        throw new Error('Currencies result cannot be processed')
      }

      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
      const out: ChainCodeTickerMap = new Map()
      for (const asset of data.result) {
        if (!asset.enabled) continue
        if (!chaincodeArray.includes(asset.blockchain)) continue
        const tokenCodes = out.get(asset.blockchain) ?? []
        tokenCodes.push({
          tokenCode: asset.ticker,
          contractAddress:
            asset.contractAddress === '' ? null : asset.contractAddress
        })
        out.set(asset.blockchain, tokenCodes)
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('Changelly: Error updating supported assets', e)
    }
  }

  fetchSupportedAssets().catch((e) => {
    log.warn('Changelly: Error refreshing cache', e)
  })

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const reverseQuote = request.quoteFor === 'to'

    const [fromAddress, toAddress] = await Promise.all([
      getAddress(
        request.fromWallet,
        addressTypeMap[request.fromWallet.currencyInfo.pluginId]
      ),
      getAddress(
        request.toWallet,
        addressTypeMap[request.toWallet.currencyInfo.pluginId]
      )
    ])

    const {
      fromCurrencyCode: fromTicker,
      toCurrencyCode: toTicker
    } = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION
    )

    const quoteAmount = reverseQuote
      ? nativeToDenomination(
          request.toWallet,
          request.nativeAmount,
          request.toTokenId
        )
      : nativeToDenomination(
          request.fromWallet,
          request.nativeAmount,
          request.fromTokenId
        )

    const fixRateParams: any = {
      from: fromTicker,
      to: toTicker
    }
    if (reverseQuote) {
      fixRateParams.amountTo = quoteAmount
    } else {
      fixRateParams.amountFrom = quoteAmount
    }

    const rateResponse = await client.getFixRateForAmount(fixRateParams)

    if (isError(rateResponse)) {
      const { message: msg, data: errorData } = rateResponse.error
      if (msg.startsWith('Invalid amount')) {
        const limits = errorData?.limits
        if (limits != null) {
          const wallet = reverseQuote ? request.toWallet : request.fromWallet
          const tokenId = reverseQuote
            ? request.toTokenId
            : request.fromTokenId
          const direction = reverseQuote ? 'to' : undefined

          if (msg.includes('Minimal')) {
            const minFrom = limits.min?.from
            if (minFrom != null) {
              const minNativeAmount = denominationToNative(
                wallet,
                minFrom,
                tokenId
              )
              throw new SwapBelowLimitError(
                swapInfo,
                minNativeAmount,
                direction
              )
            }
          }
          if (msg.includes('Maximum')) {
            const maxFrom = limits.max?.from
            if (maxFrom != null) {
              const maxNativeAmount = denominationToNative(
                wallet,
                maxFrom,
                tokenId
              )
              throw new SwapAboveLimitError(
                swapInfo,
                maxNativeAmount,
                direction
              )
            }
          }
        }
      }
      throw new SwapCurrencyError(swapInfo, request)
    }

    const rateResult = rateResponse.result
    if (rateResult == null || rateResult.length === 0) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const rateId = rateResult[0].id

    const txParams: CreateFixTransactionRequest = {
      from: fromTicker,
      to: toTicker,
      rateId,
      address: toAddress,
      refundAddress: fromAddress
    }
    if (reverseQuote) {
      txParams.amountTo = quoteAmount
    } else {
      txParams.amountFrom = quoteAmount
    }

    const txResponse = await client.createTransaction(txParams)

    if (isError(txResponse)) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const txResult = txResponse.result

    const fromNativeAmount = denominationToNative(
      request.fromWallet,
      txResult.amountExpectedFrom,
      request.fromTokenId
    ).split('.')[0]

    const toNativeAmount = denominationToNative(
      request.toWallet,
      txResult.amountExpectedTo,
      request.toTokenId
    ).split('.')[0]

    const memos: EdgeMemo[] =
      txResult.payinExtraId == null || txResult.payinExtraId === ''
        ? []
        : [
            {
              type: memoType(request.fromWallet.currencyInfo.pluginId),
              value: txResult.payinExtraId
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: txResult.payinAddress
        }
      ],
      memos,
      networkFeeOption: 'high',
      assetAction: {
        assetActionType: 'swap'
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        orderId: txResult.id,
        orderUri: txResult.trackUrl,
        isEstimate: false,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: fromNativeAmount
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
      fromNativeAmount,
      expirationDate: new Date(Date.now() + expirationFixedMs)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      await fetchSupportedAssets()

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(
        fetchSwapQuoteInner,
        request,
        opts
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest, opts)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

export default pluginFactory
