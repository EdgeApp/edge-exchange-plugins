// @flow

import {
  type EdgeSwapInfo,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeSwapResult,
  type EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'

/**
 * Ensures that a date is in the future by at least the given amount.
 */
export function ensureInFuture(
  date?: Date,
  marginSeconds: number = 30
): Date | void {
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
  quoteId?: string
): EdgeSwapQuote {
  const { fromWallet } = request

  const out: EdgeSwapQuote = {
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount:
        tx.parentNetworkFee != null ? tx.parentNetworkFee : tx.networkFee
    },
    destinationAddress,
    pluginId,
    expirationDate,
    quoteId,
    isEstimate,
    async approve(): Promise<EdgeSwapResult> {
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

const getCodes = (request: EdgeSwapRequest, toLowerCase: boolean) => {
  const res = {
    fromMainnetCode: request.fromWallet.currencyInfo.currencyCode,
    toMainnetCode: request.toWallet.currencyInfo.currencyCode,
    fromCurrencyCode: request.fromCurrencyCode,
    toCurrencyCode: request.toCurrencyCode
  }
  if (toLowerCase)
    Object.keys(res).forEach(key => {
      res[key] = res[key].toLowerCase()
    })
  return res
}

export type InvalidCurrencyCodes = {
  from: { [code: string]: 'allCodes' | 'allTokens' | string[] },
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
  const {
    fromMainnetCode,
    toMainnetCode,
    fromCurrencyCode,
    toCurrencyCode
  } = getCodes(request, false)

  function check(direction: string, main: string, token: string): boolean {
    switch (invalidCodes[direction][main]) {
      case undefined:
        return false
      case 'allCodes':
        return true
      case 'allTokens':
        return main !== token
      default:
        return invalidCodes[direction][main].some(code => code === token)
    }
  }

  if (
    check('from', fromMainnetCode, fromCurrencyCode) ||
    check('to', toMainnetCode, toCurrencyCode)
  )
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode,
      request.toCurrencyCode
    )
}

export type CurrencyCodeTranscriptions = {
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
  safeFromCurrencyCode: string,
  safeToCurrencyCode: string
} {
  const {
    fromMainnetCode,
    toMainnetCode,
    fromCurrencyCode,
    toCurrencyCode
  } = getCodes(request, toLowerCase)

  const out = {
    safeFromCurrencyCode: fromCurrencyCode,
    safeToCurrencyCode: toCurrencyCode
  }
  if (transcriptionMap[fromMainnetCode]?.[request.fromCurrencyCode]) {
    out.safeFromCurrencyCode =
      transcriptionMap[fromMainnetCode][request.fromCurrencyCode]
  }
  if (transcriptionMap[toMainnetCode]?.[request.toCurrencyCode]) {
    out.safeToCurrencyCode =
      transcriptionMap[toMainnetCode][request.toCurrencyCode]
  }
  return out
}
