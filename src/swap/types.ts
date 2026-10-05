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
  EdgeAssetAmount,
  EdgeCurrencyWallet,
  EdgeMemo,
  EdgeMetadata,
  EdgeSwapInfo,
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

  /**
   * Route privacy requirement, carried through from `EdgeSwapRequest`.
   * `'required'` means the caller needs a route that keeps the sender
   * unlinkable to the recipient, and a plugin that cannot offer one must
   * decline rather than answer with a transparent route. Declared here because
   * the installed `edge-core-js` types predate the field.
   */
  privacy?: 'required'
}

/**
 * A swap whose payout goes to a pasted address rather than one of the user's
 * wallets. Mirrors `EdgeTxActionSwapSend` from `edge-core-js`, declared here
 * because the installed `edge-core-js` types predate it.
 */
export interface EdgeTxActionSwapSend {
  actionType: 'swapSend'
  swapInfo: EdgeSwapInfo
  orderId?: string
  orderUri?: string
  isEstimate: boolean
  fromAsset: EdgeAssetAmount
  toAsset: EdgeAssetAmount
  /** The recipient. */
  payoutAddress: string
  refundAddress?: string
  /** Routed privately (a Stealth send). */
  privacy: boolean
}

/** The saved actions a swap plugin writes. */
export type EdgeTxActionSwapPlugin = EdgeTxActionSwap | EdgeTxActionSwapSend

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
