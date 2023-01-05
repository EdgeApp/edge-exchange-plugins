import { mul, sub } from 'biggystring'
import { BigNumber, Contract, ethers, PopulatedTransaction } from 'ethers'

import { round } from '../../../util/biggystringplus'
import { EdgeSwapRequestPlugin } from '../../types'
import { getMetaTokenAddress } from '../defiUtils'
import { makeErc20Contract, makeWrappedFtmContract } from './uniV2Contracts'
/**
 * Get the output swap amounts based on the requested input amount.
 * Call the router contract to calculate amounts and check if the swap path is
 * supported.
 */
export const getSwapAmounts = async (
  router: Contract,
  quoteFor: string,
  nativeAmount: string,
  fromTokenAddress: string,
  toTokenAddress: string,
  isWrappingSwap: boolean
): Promise<{ amountToSwap: string; expectedAmountOut: string }> => {
  const path = [fromTokenAddress, toTokenAddress]
  const [amountToSwap, expectedAmountOut] = (isWrappingSwap
    ? [nativeAmount, nativeAmount]
    : quoteFor === 'to'
    ? await router.getAmountsIn(nativeAmount, path)
    : quoteFor === 'from'
    ? await router.getAmountsOut(nativeAmount, path)
    : []
  ).map(String)

  if (amountToSwap == null || expectedAmountOut == null)
    throw new Error(`Failed to calculate amounts`)

  return { amountToSwap, expectedAmountOut }
}

/**
 * Get smart contract transaction(s) necessary to swap based on swap params
 */
export const getSwapTransactions = async (
  provider: ethers.providers.Provider,
  swapRequest: EdgeSwapRequestPlugin,
  router: Contract,
  amountToSwap: string,
  expectedAmountOut: string,
  toAddress: string,
  slippage: string,
  deadline: number,
  customGasPrice?: string
): Promise<PopulatedTransaction[]> => {
  const { fromWallet, fromCurrencyCode, toCurrencyCode } = swapRequest
  const {
    currencyCode: nativeCurrencyCode,
    metaTokens
  } = fromWallet.currencyInfo

  // TODO: Use our new denom implementation to get native amounts
  const wrappedCurrencyCode = `W${nativeCurrencyCode}`
  const isFromNativeCurrency = fromCurrencyCode === nativeCurrencyCode
  const isToNativeCurrency = toCurrencyCode === nativeCurrencyCode
  const isFromWrappedCurrency = fromCurrencyCode === wrappedCurrencyCode
  const isToWrappedCurrency = toCurrencyCode === wrappedCurrencyCode

  const fromTokenAddress = getMetaTokenAddress(
    metaTokens,
    isFromNativeCurrency ? wrappedCurrencyCode : fromCurrencyCode
  )
  const toTokenAddress = getMetaTokenAddress(
    metaTokens,
    isToNativeCurrency ? wrappedCurrencyCode : toCurrencyCode
  )

  // Determine router method name and params
  if (isFromNativeCurrency && isToNativeCurrency)
    throw new Error('Invalid swap: Cannot swap to the same native currency')
  const path = [fromTokenAddress, toTokenAddress]

  const gasPrice =
    customGasPrice != null
      ? ethers.utils.parseUnits(customGasPrice, 'gwei')
      : await provider.getGasPrice()

  const addressToApproveTx = async (
    tokenAddress: string,
    contractAddress: string
  ): Promise<ethers.PopulatedTransaction> => {
    const tokenContract = makeErc20Contract(provider, tokenAddress)
    const promise = tokenContract.populateTransaction.approve(
      contractAddress,
      BigNumber.from(amountToSwap),
      { gasLimit: '60000', gasPrice }
    )
    return await promise
  }

  const txPromises: Array<Promise<PopulatedTransaction>> = []

  // Deposit native currency for wrapped token
  if (isFromNativeCurrency && isToWrappedCurrency) {
    txPromises.push(
      ...[
        makeWrappedFtmContract(provider).populateTransaction.deposit({
          gasLimit: '60000',
          gasPrice,
          value: amountToSwap
        })
      ]
    )
  }
  // Withdraw wrapped token for native currency
  else if (isFromWrappedCurrency && isToNativeCurrency) {
    txPromises.push(
      // Deposit Tx
      makeWrappedFtmContract(provider).populateTransaction.withdraw(
        amountToSwap,
        {
          gasLimit: '60000',
          gasPrice
        }
      )
    )
  }
  // Swap native currency for token
  else {
    const slippageMultiplier = sub('1', slippage)
    if (isFromNativeCurrency && !isToNativeCurrency) {
      txPromises.push(
        // Swap Tx
        router.populateTransaction.swapExactETHForTokens(
          round(mul(expectedAmountOut, slippageMultiplier)),
          path,
          toAddress,
          deadline,
          { gasLimit: '250000', gasPrice, value: amountToSwap }
        )
      )
    }
    // Swap token for native currency
    else if (!isFromNativeCurrency && isToNativeCurrency) {
      txPromises.push(
        // Approve TX
        addressToApproveTx(path[0], router.address),
        // Swap Tx
        router.populateTransaction.swapExactTokensForETH(
          amountToSwap,
          round(mul(expectedAmountOut, slippageMultiplier)),
          path,
          toAddress,
          deadline,
          { gasLimit: '250000', gasPrice }
        )
      )
    }
    // Swap token for token
    else if (!isFromNativeCurrency && !isToNativeCurrency) {
      txPromises.push(
        // Approve TX
        addressToApproveTx(path[0], router.address),
        // Swap Tx
        router.populateTransaction.swapExactTokensForTokens(
          amountToSwap,
          round(mul(expectedAmountOut, slippageMultiplier)),
          path,
          toAddress,
          deadline,
          { gasLimit: '600000', gasPrice }
        )
      )
    } else {
      throw new Error('Unhandled swap type')
    }
  }

  return await Promise.all(txPromises)
}
