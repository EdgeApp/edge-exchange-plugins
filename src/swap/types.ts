import { asEither, asNumber, asString } from 'cleaners'
import { EdgeCurrencyWallet } from 'edge-core-js'

export interface EdgeSwapRequestPlugin {
  fromWallet: EdgeCurrencyWallet
  toWallet: EdgeCurrencyWallet
  fromTokenId?: string
  toTokenId?: string
  nativeAmount: string
  quoteFor: 'from' | 'max' | 'to'
  fromCurrencyCode: string
  toCurrencyCode: string
}

export const asNumberString = (raw: any): string => {
  const n = asEither(asString, asNumber)(raw)
  return n.toString()
}
