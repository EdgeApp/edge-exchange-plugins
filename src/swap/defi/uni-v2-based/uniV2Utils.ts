import { mul, round, sub } from 'biggystring'
import { BigNumber, Contract, ethers, PopulatedTransaction } from 'ethers'

import { InOutTokenAddresses } from '../defiUtils'
import { makeErc20Contract } from './uniV2Contracts'
/**
 * Get the output swap amounts based on the requested input amount.
 * Call the router contract to calculate amounts and check if the swap path is
 * supported.
 */
export const getSwapAmounts = async (
  router: Contract,
  quoteFor: string,
  nativeAmount: string,
  path: string[],
  isWrappingSwap: boolean
): Promise<{ amountToSwap: string; expectedAmountOut: string }> => {
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
  inOutAddresses: InOutTokenAddresses,
  path: string[],
  router: Contract,
  wrappedTokenContract: Contract,
  amountToSwap: string,
  expectedAmountOut: string,
  toAddress: string,
  slippage: string,
  deadline: number,
  previousGasPrice?: string
): Promise<PopulatedTransaction[]> => {
  const {
    fromTokenAddress,
    isFromNativeCurrency,
    isToNativeCurrency,
    isFromWrappedCurrency,
    isToWrappedCurrency
  } = inOutAddresses

  // Determine router method name and params
  if (isFromNativeCurrency && isToNativeCurrency)
    throw new Error('Invalid swap: Cannot swap to the same native currency')

  const gasPrice =
    previousGasPrice != null
      ? ethers.utils.parseUnits(previousGasPrice, 'gwei')
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
        wrappedTokenContract.populateTransaction.deposit({
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
      wrappedTokenContract.populateTransaction.withdraw(amountToSwap, {
        gasLimit: '60000',
        gasPrice
      })
    )
  }
  // Swap native currency for token
  else {
    const slippageMultiplier = sub('1', slippage)
    if (isFromNativeCurrency && !isToNativeCurrency) {
      txPromises.push(
        // Swap Tx
        router.populateTransaction.swapExactETHForTokens(
          round(mul(expectedAmountOut, slippageMultiplier), 0),
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
        addressToApproveTx(fromTokenAddress, router.address),
        // Swap Tx
        router.populateTransaction.swapExactTokensForETH(
          amountToSwap,
          round(mul(expectedAmountOut, slippageMultiplier), 0),
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
        addressToApproveTx(fromTokenAddress, router.address),
        // Swap Tx
        router.populateTransaction.swapExactTokensForTokens(
          amountToSwap,
          round(mul(expectedAmountOut, slippageMultiplier), 0),
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
