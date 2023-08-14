import { EdgeMetadata, EdgeTxSwap } from 'edge-core-js'
import { Client, Wallet } from 'xrpl'

/**
 * Duplicated from edge-currency-accountbased until this
 * is elevatd to a type in edge-core-js
 */
export interface MakeTxParams {
  type: 'MakeTxDexSwap'
  metadata?: EdgeMetadata
  swapData?: EdgeTxSwap
  fromTokenId?: string
  fromNativeAmount: string
  toTokenId?: string
  toNativeAmount: string

  /**
   * UNIX time (seconds) to expire the DEX swap if it hasn't executed
   */
  expiration?: number
}

/**
 * Below types copied from https://github.com/florent-uzio/xrpl.js-demo.git
 */
export interface TxnOptions {
  wallet: Wallet
  client: Client
  showLogs?: boolean
}

export type MethodOptions = Pick<TxnOptions, 'showLogs' | 'client'>

export type LedgerIndex = number | ('validated' | 'closed' | 'current')

export interface BaseRequest {
  [x: string]: unknown
  id?: number | string
  command: string
  api_version?: number
}

export interface LookupByLedgerRequest {
  ledger_hash?: string
  ledger_index?: LedgerIndex
}

export interface BookOfferCurrency {
  currency: string
  issuer?: string
}
