import { asObject, asString } from 'cleaners'
import { Client, Wallet } from 'xrpl'

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

export const asXrpNetworkLocation = asObject({
  currency: asString,
  issuer: asString
})
