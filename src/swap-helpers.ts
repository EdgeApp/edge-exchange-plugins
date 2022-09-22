import { add } from 'biggystring'
import {
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'

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

export function makeSwapPluginQuote(
  request: EdgeSwapRequest,
  fromNativeAmount: string,
  toNativeAmount: string,
  tx: EdgeTransaction,
  destinationAddress: string,
  pluginId: string,
  isEstimate: boolean = false,
  expirationDate?: Date,
  quoteId?: string,
  preTx?: EdgeTransaction
): EdgeSwapQuote {
  const { fromWallet } = request

  let nativeAmount =
    tx.parentNetworkFee != null ? tx.parentNetworkFee : tx.networkFee

  if (preTx != null)
    nativeAmount = add(
      nativeAmount,
      preTx.parentNetworkFee != null ? preTx.parentNetworkFee : preTx.networkFee
    )

  const out: EdgeSwapQuote = {
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount
    },
    pluginId,
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

interface AllCodes {
  fromMainnetCode: string
  toMainnetCode: string
  fromCurrencyCode: string
  toCurrencyCode: string
}

export const getCodes = (request: EdgeSwapRequest): AllCodes => ({
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
  from: { [code: string]: 'allCodes' | 'allTokens' | string[] }
  to: { [code: string]: 'allCodes' | 'allTokens' | string[] }
}

/**
 * Throws if either currency code has been disabled by the plugin
 */
export function checkInvalidCodes(
  invalidCodes: InvalidCurrencyCodes,
  request: EdgeSwapRequest,
  swapInfo: EdgeSwapInfo
): void {
  const { fromPluginId, toPluginId } = getPluginIds(request)
  const {
    fromMainnetCode,
    toMainnetCode,
    fromCurrencyCode,
    toCurrencyCode
  } = getCodes(request)

  function check(
    direction: 'from' | 'to',
    pluginId: string,
    main: string,
    token: string
  ): boolean {
    const codes = invalidCodes[direction][pluginId]
    if (codes == null) return false
    if (codes === 'allCodes') return true
    if (codes === 'allTokens') return main !== token
    return codes.some(code => code === token)
  }

  if (
    check('from', fromPluginId, fromMainnetCode, fromCurrencyCode) ||
    check('to', toPluginId, toMainnetCode, toCurrencyCode)
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

/**
 * Transcribes requested currency codes into plugin compatible unique IDs
 */
export function safeCurrencyCodes(
  transcriptionMap: CurrencyCodeTranscriptions,
  request: EdgeSwapRequest,
  toLowerCase: boolean = false
): {
  safeFromCurrencyCode: string
  safeToCurrencyCode: string
} {
  const { fromPluginId, toPluginId } = getPluginIds(request)
  const { fromCurrencyCode, toCurrencyCode } = getCodes(request)

  const out = {
    safeFromCurrencyCode: fromCurrencyCode,
    safeToCurrencyCode: toCurrencyCode
  }
  if (transcriptionMap[fromPluginId]?.[request.fromCurrencyCode] != null) {
    out.safeFromCurrencyCode =
      transcriptionMap[fromPluginId][request.fromCurrencyCode]
  }
  if (transcriptionMap[toPluginId]?.[request.toCurrencyCode] != null) {
    out.safeToCurrencyCode =
      transcriptionMap[toPluginId][request.toCurrencyCode]
  }

  if (toLowerCase) {
    out.safeFromCurrencyCode = out.safeFromCurrencyCode.toLowerCase()
    out.safeToCurrencyCode = out.safeToCurrencyCode.toLowerCase()
  }
  return out
}

export interface MainnetPluginIdTranscriptionMap {
  [pluginId: string]: string
}

/**
 * Returns all four codes with mainnet transcription
 */
export const getCodesWithMainnetTranscription = (
  request: EdgeSwapRequest,
  transcriptionMap: MainnetPluginIdTranscriptionMap
): AllCodes => {
  const {
    fromCurrencyCode,
    toCurrencyCode,
    fromMainnetCode,
    toMainnetCode
  } = getCodes(request)
  return {
    fromMainnetCode:
      transcriptionMap[request.fromWallet.currencyInfo.pluginId] ??
      fromMainnetCode,
    toMainnetCode:
      transcriptionMap[request.toWallet.currencyInfo.pluginId] ?? toMainnetCode,
    fromCurrencyCode: fromCurrencyCode,
    toCurrencyCode: toCurrencyCode
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
