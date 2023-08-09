import { add, sub } from 'biggystring'
import {
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeTransaction,
  JsonObject,
  SwapCurrencyError
} from 'edge-core-js/types'

import { EdgeSwapRequestPlugin } from './swap/types'

const likeKindAssets = [
  ['BTC', 'WBTC', 'SBTC', 'RBTC'],
  ['ETH', 'WETH'],
  ['USDC', 'USDT', 'DAI']
]

/**
 * Ensures that a date is in the future by at least the given amount.
 */
export function ensureInFuture(
  date?: Date,
  marginSeconds: number = 30
): Date | undefined {
  if (date == null) return
  const target = Date.now() + marginSeconds * 1000
  return target < date.valueOf() ? date : new Date(target)
}

export interface SwapOrder {
  request: EdgeSwapRequest
  swapInfo: EdgeSwapInfo
  spendInfo: EdgeSpendInfo
  fromNativeAmount: string
  expirationDate?: Date
  preTx?: EdgeTransaction
  metadataNotes?: string
}

export async function makeSwapPluginQuote(
  order: SwapOrder
): Promise<EdgeSwapQuote> {
  const {
    fromNativeAmount,
    request,
    swapInfo,
    spendInfo,
    expirationDate,
    preTx,
    metadataNotes
  } = order

  const { fromWallet } = request
  const tx = await fromWallet.makeSpend(spendInfo)
  const toNativeAmount = spendInfo.swapData?.payoutNativeAmount
  const destinationAddress = spendInfo.swapData?.payoutAddress
  const isEstimate = spendInfo.swapData?.isEstimate ?? false
  const quoteId = spendInfo.swapData?.orderId
  if (
    fromNativeAmount == null ||
    toNativeAmount == null ||
    destinationAddress == null
  ) {
    throw new Error(
      `Invalid makeSwapPluginQuote args from ${swapInfo.pluginId}`
    )
  }

  let nativeAmount =
    tx.parentNetworkFee != null ? tx.parentNetworkFee : tx.networkFee

  if (preTx != null)
    nativeAmount = add(
      nativeAmount,
      preTx.parentNetworkFee != null ? preTx.parentNetworkFee : preTx.networkFee
    )

  const out: EdgeSwapQuote = {
    request,
    swapInfo,
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount
    },
    pluginId: swapInfo.pluginId,
    expirationDate,
    isEstimate,
    async approve(opts?: EdgeSwapApproveOptions): Promise<EdgeSwapResult> {
      if (preTx != null) {
        const signedTransaction = await fromWallet.signTx(preTx)
        const broadcastedTransaction = await fromWallet.broadcastTx(
          signedTransaction
        )
        await fromWallet.saveTx(broadcastedTransaction)
      }
      tx.metadata = { ...(opts?.metadata ?? {}), ...tx.metadata }
      if (metadataNotes != null) {
        tx.metadata.notes = `${metadataNotes}\n\n` + (tx.metadata.notes ?? '')
      }

      const signedTransaction = await fromWallet.signTx(tx)
      const broadcastedTransaction = await fromWallet.broadcastTx(
        signedTransaction
      )
      await fromWallet.saveTx(signedTransaction)

      return {
        transaction: broadcastedTransaction,
        orderId: quoteId,
        destinationAddress
      }
    },

    async close() {}
  }
  return out
}

export const getMaxSwappable = async <T extends any[]>(
  fetchSwap: (request: EdgeSwapRequestPlugin, ...args: T) => Promise<SwapOrder>,
  request: EdgeSwapRequestPlugin,
  ...args: T
): Promise<EdgeSwapRequestPlugin> => {
  if (request.quoteFor !== 'max') return request

  const requestCopy = { ...request }
  const { fromWallet, fromCurrencyCode } = requestCopy

  // First attempt a swap that uses the entire balance
  const balance = fromWallet.balances[fromCurrencyCode] ?? '0'
  requestCopy.nativeAmount = balance
  requestCopy.quoteFor = 'from'
  const swapOrder = await fetchSwap(requestCopy, ...args)

  // Then use getMaxSpendable with the partner's address
  delete swapOrder.spendInfo.spendTargets[0].nativeAmount
  let maxAmount = await fromWallet.getMaxSpendable(swapOrder.spendInfo)

  // Subtract fee from pretx
  if (
    swapOrder.preTx != null &&
    fromCurrencyCode === fromWallet.currencyInfo.currencyCode
  ) {
    maxAmount = sub(maxAmount, swapOrder.preTx.networkFee)
  }

  // Update and return the request object
  requestCopy.nativeAmount = maxAmount
  return requestCopy
}

// Store custom fees so a request can use consistent fees when calling makeSpend multiple times
export const customFeeCacheMap: {
  [uid: string]: { customNetworkFee?: JsonObject; timestamp: number }
} = {}

let swapId = '0'
export const customFeeCache = {
  createUid: (): string => {
    swapId = add(swapId, '1')
    customFeeCacheMap[swapId] = { timestamp: Date.now() }
    return swapId
  },
  getFees: (uid: string): JsonObject | undefined => {
    return customFeeCacheMap?.[uid]?.customNetworkFee
  },
  setFees: (uid: string, customNetworkFee?: JsonObject): void => {
    for (const id of Object.keys(customFeeCacheMap)) {
      if (Date.now() > customFeeCacheMap[id].timestamp + 30000) {
        delete customFeeCacheMap[id] // eslint-disable-line
      }
    }
    customFeeCacheMap[uid] = { customNetworkFee, timestamp: Date.now() }
  }
}

interface AllCodes {
  fromMainnetCode: string
  toMainnetCode: string
  fromCurrencyCode: string
  toCurrencyCode: string
}

export const getCodes = (request: EdgeSwapRequestPlugin): AllCodes => ({
  fromMainnetCode: request.fromWallet.currencyInfo.currencyCode,
  toMainnetCode: request.toWallet.currencyInfo.currencyCode,
  fromCurrencyCode: request.fromCurrencyCode,
  toCurrencyCode: request.toCurrencyCode
})

const getPluginIds = (
  request: EdgeSwapRequest
): { fromPluginId: string; toPluginId: string } => ({
  fromPluginId: request.fromWallet.currencyInfo.pluginId,
  toPluginId: request.toWallet.currencyInfo.pluginId
})

export interface InvalidCurrencyCodes {
  from: { [pluginId: string]: 'allCodes' | 'allTokens' | string[] }
  to: { [pluginId: string]: 'allCodes' | 'allTokens' | string[] }
}

const defaultInvalidCodes: InvalidCurrencyCodes = {
  from: { ethereum: ['REP'] },
  to: { ethereum: ['REP'] }
}

/**
 * Throws if either currency code has been disabled by the plugin
 */
export function checkInvalidCodes(
  invalidCodes: InvalidCurrencyCodes,
  request: EdgeSwapRequestPlugin,
  swapInfo: EdgeSwapInfo
): void {
  const { fromPluginId, toPluginId } = getPluginIds(request)
  const {
    fromMainnetCode,
    toMainnetCode,
    fromCurrencyCode,
    toCurrencyCode
  } = getCodes(request)

  const isSameAsset = (request: EdgeSwapRequest): boolean =>
    request.fromWallet.currencyInfo.pluginId ===
      request.toWallet.currencyInfo.pluginId &&
    request.fromCurrencyCode === request.toCurrencyCode

  function check(
    codeMap: InvalidCurrencyCodes,
    direction: 'from' | 'to',
    pluginId: string,
    main: string,
    token: string
  ): boolean {
    const codes = codeMap[direction][pluginId]
    if (codes == null) return false
    if (codes === 'allCodes') return true
    if (codes === 'allTokens') return main !== token
    return codes.some(code => code === token)
  }

  if (
    check(
      invalidCodes,
      'from',
      fromPluginId,
      fromMainnetCode,
      fromCurrencyCode
    ) ||
    check(
      defaultInvalidCodes,
      'from',
      fromPluginId,
      fromMainnetCode,
      fromCurrencyCode
    ) ||
    check(invalidCodes, 'to', toPluginId, toMainnetCode, toCurrencyCode) ||
    check(
      defaultInvalidCodes,
      'to',
      toPluginId,
      toMainnetCode,
      toCurrencyCode
    ) ||
    isSameAsset(request)
  )
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode,
      request.toCurrencyCode
    )
}

export interface CurrencyCodeTranscriptions {
  [code: string]: {
    [code: string]: string
  }
}

export interface MainnetPluginIdTranscriptionMap {
  [pluginId: string]: string
}

export interface CurrencyCodeTranscriptionMap {
  [pluginId: string]: {
    [currencyCode: string]: string
  }
}

const defaultCurrencyCodeTranscriptionMap: CurrencyCodeTranscriptionMap = {
  ethereum: {
    REPV2: 'REP'
  }
}

const defaultMainnetTranscriptionMap: MainnetPluginIdTranscriptionMap = {
  optimism: 'OP', // mainnet code is ETH
  zksync: 'ZKSYNC' // mainnet code is also ETH
}

/**
 * Returns all four codes with transcription
 */
export const getCodesWithTranscription = (
  request: EdgeSwapRequestPlugin,
  mainnetTranscriptionMap: MainnetPluginIdTranscriptionMap,
  currencyCodeTranscriptionMap: CurrencyCodeTranscriptionMap = {}
): AllCodes => {
  const {
    fromCurrencyCode,
    toCurrencyCode,
    fromMainnetCode,
    toMainnetCode
  } = getCodes(request)

  for (const pluginId of Object.keys(defaultCurrencyCodeTranscriptionMap)) {
    if (currencyCodeTranscriptionMap[pluginId] == null)
      currencyCodeTranscriptionMap[pluginId] =
        defaultCurrencyCodeTranscriptionMap[pluginId]
    else
      currencyCodeTranscriptionMap[pluginId] = {
        ...defaultCurrencyCodeTranscriptionMap[pluginId],
        ...currencyCodeTranscriptionMap[pluginId]
      }
  }

  for (const pluginId of Object.keys(defaultMainnetTranscriptionMap)) {
    if (mainnetTranscriptionMap[pluginId] == null)
      mainnetTranscriptionMap[pluginId] =
        defaultMainnetTranscriptionMap[pluginId]
  }

  return {
    fromMainnetCode:
      mainnetTranscriptionMap[request.fromWallet.currencyInfo.pluginId] ??
      fromMainnetCode,
    toMainnetCode:
      mainnetTranscriptionMap[request.toWallet.currencyInfo.pluginId] ??
      toMainnetCode,
    fromCurrencyCode:
      currencyCodeTranscriptionMap[request.fromWallet.currencyInfo.pluginId]?.[
        fromCurrencyCode
      ] ?? fromCurrencyCode,
    toCurrencyCode:
      currencyCodeTranscriptionMap[request.toWallet.currencyInfo.pluginId]?.[
        toCurrencyCode
      ] ?? toCurrencyCode
  }
}

export const isLikeKind = (
  fromCurrencyCode: string,
  toCurrencyCode: string
): boolean => {
  // Check if the swap is Like Kind
  for (const assetList of likeKindAssets) {
    const matchFrom = assetList.find(cc => cc === fromCurrencyCode)
    if (matchFrom != null) {
      const matchTo = assetList.find(cc => cc === toCurrencyCode)
      if (matchTo != null) {
        return true
      }
    }
  }
  return false
}

export const getTokenId = (
  coreWallet: EdgeCurrencyWallet,
  currencyCode: string
): string | undefined => {
  if (coreWallet.currencyInfo.currencyCode === currencyCode) return
  const { allTokens } = coreWallet.currencyConfig
  return Object.keys(allTokens).find(
    edgeToken => allTokens[edgeToken].currencyCode === currencyCode
  )
}

export const consify = (val: any): void =>
  console.log(JSON.stringify(val, null, 2))

export const checkEthTokensOnly = (
  swapInfo: EdgeSwapInfo,
  request: EdgeSwapRequest
): void => {
  const currencyFromWallet = request.fromWallet.currencyInfo.currencyCode
  const currencyToWallet = request.toWallet.currencyInfo.currencyCode

  if (
    currencyFromWallet !== request.fromCurrencyCode &&
    currencyFromWallet !== 'ETH'
  ) {
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode as string,
      request.toCurrencyCode
    )
  } else if (
    currencyToWallet !== request.toCurrencyCode &&
    currencyToWallet !== 'ETH'
  ) {
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode as string,
      request.toCurrencyCode
    )
  }
}
