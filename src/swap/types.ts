import { asEither, asNumber, asString } from 'cleaners'
import {
  EdgeAssetAction,
  EdgeCurrencyWallet,
  EdgeTxActionSwap
} from 'edge-core-js'

export interface EdgeSwapRequestPlugin {
  fromWallet: EdgeCurrencyWallet
  toWallet: EdgeCurrencyWallet
  fromTokenId: string | null
  toTokenId: string | null
  nativeAmount: string
  quoteFor: 'from' | 'max' | 'to'
  fromCurrencyCode: string
  toCurrencyCode: string
}

export const asNumberString = (raw: any): string => {
  const n = asEither(asString, asNumber)(raw)
  return n.toString()
}

export interface StringMap {
  [key: string]: string
}

/**
 * Duplicated from edge-currency-accountbased until this
 * is elevatd to a type in edge-core-js
 */
export type MakeTxParams =
  | {
      type: 'MakeTxDexSwap'
      assetAction: EdgeAssetAction
      savedAction: EdgeTxActionSwap
      fromTokenId: string | null
      fromNativeAmount: string
      toTokenId: string | null
      toNativeAmount: string

      /**
       * UNIX time (seconds) to expire the DEX swap if it hasn't executed
       */
      expiration?: number
    }
  | {
      type: 'MakeTxDeposit'
      assets: Array<{
        amount: string
        asset: string
        decimals: string
      }>
      memo: string
      assetAction: EdgeAssetAction
      savedAction: EdgeTxActionSwap
    }
