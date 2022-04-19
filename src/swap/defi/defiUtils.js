// @flow

import { type EdgeCurrencyInfo, type EdgeMetaToken } from 'edge-core-js/types'

/**
 * Get the token contract addresses from the wallet's EdgeMetaTokens
 */
export const getMetaTokenAddress = (
  metaTokens: EdgeMetaToken[],
  tokenCurrencyCode: string
): string => {
  const metaToken = metaTokens.find(mt => mt.currencyCode === tokenCurrencyCode)

  if (metaToken == null || metaToken?.contractAddress === undefined)
    throw new Error('Could not find contract address for ' + tokenCurrencyCode)

  return metaToken.contractAddress ?? ''
}

/**
 * Determine if the tokens are wrapped and return the appropriate wrapped
 * contract addresses, if different.
 */
export const getInOutTokenAddresses = (
  currencyInfo: EdgeCurrencyInfo,
  fromCurrencyCode: string,
  toCurrencyCode: string
): {
  fromTokenAddress: string,
  toTokenAddress: string,
  isWrappingSwap: boolean
} => {
  const { currencyCode: nativeCurrencyCode, metaTokens } = currencyInfo
  const wrappedCurrencyCode = `W${nativeCurrencyCode}`
  const isFromNativeCurrency = fromCurrencyCode === nativeCurrencyCode
  const isToNativeCurrency = toCurrencyCode === nativeCurrencyCode
  const isFromWrappedCurrency = fromCurrencyCode === wrappedCurrencyCode
  const isToWrappedCurrency = toCurrencyCode === wrappedCurrencyCode
  const isWrappingSwap =
    (isFromNativeCurrency && isToWrappedCurrency) ||
    (isFromWrappedCurrency && isToNativeCurrency)

  const fromTokenAddress = getMetaTokenAddress(
    metaTokens,
    isFromNativeCurrency ? wrappedCurrencyCode : fromCurrencyCode
  )
  const toTokenAddress = getMetaTokenAddress(
    metaTokens,
    isToNativeCurrency ? wrappedCurrencyCode : toCurrencyCode
  )

  return { fromTokenAddress, toTokenAddress, isWrappingSwap }
}
