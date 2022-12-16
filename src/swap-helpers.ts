import { add } from 'biggystring'
import {
  EdgeCurrencyWallet,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeTransaction,
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
  preTx?: EdgeTransaction,
  metadataNotes?: string
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
    request,
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
