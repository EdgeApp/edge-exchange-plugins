import {
  asArray,
  asDate,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeAssetAction,
  EdgeCurrencyWallet,
  EdgeMemo,
  EdgeMetadata,
  EdgeTransaction,
  EdgeTxAction,
  EdgeTxActionSwap,
  EdgeTxSwap
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

      pendingTxs?: EdgeTransaction[]
      /** Optional raw transaction data payload for chains that require it (e.g., Cosmos) */
      txData?: string

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
      pendingTxs?: EdgeTransaction[]
    }
  | {
      type: 'MakeTx'
      unsignedTx: Uint8Array
      metadata?: MakeTxMetadata
    }

export interface MakeTxMetadata {
  assetAction?: EdgeAssetAction
  savedAction?: EdgeTxAction
  metadata?: EdgeMetadata
  swapData?: EdgeTxSwap
  memos?: EdgeMemo[]
}

export const asRatesResponse = asObject({
  data: asArray(
    asObject({
      currency_pair: asString,
      date: asString,
      exchangeRate: asEither(asString, asNull)
    })
  )
})

export type RatesRespose = ReturnType<typeof asRatesResponse>

// v3/rates response cleaner (matches GUI's shape)
const asV3CryptoAsset = asObject({
  pluginId: asString,
  tokenId: asOptional(asEither(asString, asNull))
})
const asV3CryptoRate = asObject({
  isoDate: asOptional(asDate),
  asset: asV3CryptoAsset,
  rate: asOptional(asNumber)
})
const asV3FiatRate = asObject({
  isoDate: asOptional(asDate),
  fiatCode: asString,
  rate: asOptional(asNumber)
})
export const asV3RatesParams = asObject({
  targetFiat: asString,
  crypto: asArray(asV3CryptoRate),
  fiat: asArray(asV3FiatRate)
})
export type V3RatesParams = ReturnType<typeof asV3RatesParams>
