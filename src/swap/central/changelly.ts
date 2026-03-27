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
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  getCodesWithTranscription,
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
  disklet: { list: (path: string) => Promise<Record<string, 'file' | 'folder'>>; getText: (path: string) => Promise<string> }
): ChangellyClient {
  const getUserParams = ((disklet) => async (ts = Date.now()) => {
    const loginItems = Object.entries(await disklet.list('logins'))
      .filter((listing): listing is [string, 'file'] => listing[1] === 'file')
      // eslint-disable-next-line @typescript-eslint/promise-function-async
      .map(async ([name]) => await disklet.getText(name))

    const profiles = (await Promise.all(loginItems))
      .map((item) => JSON.parse(item))
      .sort((a, b) => {
        return (
          new Date(b.lastLogin).getTime() - new Date(a.lastLogin).getTime()
        )
      })

    if (profiles.length === 0) throw new Error('Unable to detect user params')

    return {
      userId: profiles[0].userId,
      username: profiles[0].username,
      ts
    }
  })(disklet)

  const changellyClientRequest = async <
    T extends Object | undefined,
    R = any
  >(
    body: Omit<Body<T>, 'jsonrpc' | 'id'>,
    promoCode?: string,
    ignoreUserInfo = false
  ): Promise<Result<R> | ErrorResult> => {
    const params = ignoreUserInfo
      ? {
          userId: 'BVEeyRKyD1g6awUBc+EJxsFRI9irdsAe5O6lWsZRsxg=',
          username: 'test',
          ts: Date.now()
        }
      : await getUserParams()
    const jsonBody = JSON.stringify({
      ...body,
      jsonrpc: '2.0',
      id: body.method + ':' + String(params.userId)
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Auth': btoa([params.username, params.userId, params.ts].join(':'))
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
        undefined,
        true
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

const CACHE_TTL_MS = 1000 * 60 * 10

const cache = {
  map: new Map<string, CurrenciesResponse>(),
  time: 0,
  pending: undefined as Promise<void> | undefined
}

const pluginFactory = ({
  log,
  ...env
}: EdgeCorePluginOptions): EdgeSwapPlugin => {
  const { io } = env
  const { fetch, disklet } = io
  const client = createClient(fetch, disklet)

  const swapInfo: EdgeSwapInfo = {
    pluginId,
    isDex: false,
    displayName: 'Changelly',
    supportEmail: 'support@changelly.com'
  }

  const refreshCache = async (): Promise<void> => {
    if (Date.now() - cache.time < CACHE_TTL_MS) return await Promise.resolve()
    if (cache.pending != null) return await cache.pending

    cache.pending = client
      .getCurrenciesFull()
      .then((data) => {
        if (isError(data) && data.error.code === -32600) {
          throw new SwapPermissionError(swapInfo, 'noVerification')
        }
        if (isError(data)) {
          throw new Error('Currencies result cannot be processed')
        }

        const newMap = new Map<string, CurrenciesResponse>()
        data.result.forEach((item) => {
          if (!item.enabled) return
          newMap.set(item.name, item)
          newMap.set(item.ticker, item)
        })
        cache.map = newMap
        cache.time = Date.now()
      })
      .finally(() => {
        cache.pending = undefined
      })

    return await cache.pending
  }

  refreshCache().catch((e) => {
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
      fromCurrencyCode,
      toCurrencyCode
    } = getCodesWithTranscription(request, MAINNET_CODE_TRANSCRIPTION)

    const fromTicker =
      cache.map.get(fromCurrencyCode)?.ticker ?? fromCurrencyCode.toLowerCase()
    const toTicker =
      cache.map.get(toCurrencyCode)?.ticker ?? toCurrencyCode.toLowerCase()

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

      await refreshCache()

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
