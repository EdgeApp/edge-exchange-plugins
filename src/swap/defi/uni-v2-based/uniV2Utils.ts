import { eq, mul, round, sub } from 'biggystring'
import {
  EdgeSwapInfo,
  EdgeSwapRequest,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js'
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
  request: EdgeSwapRequest,
  swapInfo: EdgeSwapInfo,
  path: unknown,
  isWrappingSwap: boolean
): Promise<{ amountToSwap: string; expectedAmountOut: string }> => {
  const { nativeAmount, quoteFor } = request

  // ---------------------------------------------------------------------------
  // 1. Try the user-requested amount
  // ---------------------------------------------------------------------------
  const [amountToSwap, expectedAmountOut] = (isWrappingSwap
    ? [nativeAmount, nativeAmount]
    : quoteFor === 'to'
    ? await router.getAmountsIn(nativeAmount, path).catch(() => ['0', '0'])
    : quoteFor === 'from'
    ? await router.getAmountsOut(nativeAmount, path).catch(() => ['0', '0'])
    : []
  ).map(String)

  if (
    amountToSwap == null ||
    expectedAmountOut == null ||
    amountToSwap === '0' ||
    expectedAmountOut === '0'
  ) {
    // ---------------------------------------------------------------------------
    // 2. Fallback: check a reasonable viable swap and possibly throw below min
    // ---------------------------------------------------------------------------
    const { currencyInfo } =
      quoteFor === 'from' ? request.fromWallet : request.toWallet
    const tokenId =
      quoteFor === 'from' ? request.fromTokenId : request.toTokenId
    const token =
      tokenId == null
        ? undefined
        : quoteFor === 'from'
        ? request.fromWallet.currencyConfig.allTokens[tokenId]
        : request.toWallet.currencyConfig.allTokens[tokenId]
    const { denominations } = token == null ? currencyInfo : token
    const { multiplier } = denominations[0]
    const testAmountOut = (quoteFor === 'to'
      ? await router.getAmountsIn(multiplier, path).catch(() => ['0', '0'])
      : await router
          .getAmountsOut(multiplier, path)
          .catch(() => ['0', '0']))[1].toString()

    // If the test's output amount also failed, the route is unsupported.
    if (eq(testAmountOut, '0')) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Otherwise, amount is below protocol minimum.
    throw new SwapBelowLimitError(
      swapInfo,
      undefined,
      quoteFor === 'to' ? 'to' : 'from'
    )
  }

  return { amountToSwap, expectedAmountOut }
}

/**
 * Get smart contract transaction(s) necessary to swap based on swap params
 */
export const getSwapTransactions = async (
  provider: ethers.providers.Provider,
  inOutAddresses: InOutTokenAddresses,
  path: unknown,
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

  const withEstimatedGas = async (
    ethersTx: ethers.PopulatedTransaction | Promise<ethers.PopulatedTransaction>
  ): Promise<ethers.PopulatedTransaction> => {
    const tx = await ethersTx
    tx.gasLimit = await provider
      .estimateGas(tx)
      .then(
        estimate => estimate.mul(5).div(4)
        /* Add 25% extra gas limit buffer; 5/4=1.25 */
      )
      .catch(_ => tx.gasLimit)
    return tx
  }

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
    const promise = withEstimatedGas(
      tokenContract.populateTransaction.approve(
        contractAddress,
        BigNumber.from(amountToSwap),
        { gasLimit: '60000', gasPrice }
      )
    )
    return await promise
  }

  const txPromises: Array<Promise<PopulatedTransaction>> = []

  // Deposit native currency for wrapped token
  if (isFromNativeCurrency && isToWrappedCurrency) {
    txPromises.push(
      withEstimatedGas(
        wrappedTokenContract.populateTransaction.deposit({
          gasLimit: '60000',
          gasPrice,
          value: amountToSwap
        })
      )
    )
  }
  // Withdraw wrapped token for native currency
  else if (isFromWrappedCurrency && isToNativeCurrency) {
    txPromises.push(
      // Deposit Tx
      withEstimatedGas(
        wrappedTokenContract.populateTransaction.withdraw(amountToSwap, {
          gasLimit: '60000',
          gasPrice
        })
      )
    )
  }
  // Swap native currency for token
  else {
    const slippageMultiplier = sub('1', slippage)
    if (isFromNativeCurrency && !isToNativeCurrency) {
      txPromises.push(
        // Swap Tx

        withEstimatedGas(
          router.populateTransaction.swapExactETHForTokens(
            round(mul(expectedAmountOut, slippageMultiplier), 0),
            path,
            toAddress,
            deadline,
            { gasLimit: '250000', gasPrice, value: amountToSwap }
          )
        )
      )
    }
    // Swap token for native currency
    else if (!isFromNativeCurrency && isToNativeCurrency) {
      txPromises.push(
        // Approve TX
        addressToApproveTx(fromTokenAddress, router.address),
        // Swap Tx
        withEstimatedGas(
          router.populateTransaction.swapExactTokensForETH(
            amountToSwap,
            round(mul(expectedAmountOut, slippageMultiplier), 0),
            path,
            toAddress,
            deadline,
            { gasLimit: '250000', gasPrice }
          )
        )
      )
    }
    // Swap token for token
    else if (!isFromNativeCurrency && !isToNativeCurrency) {
      txPromises.push(
        // Approve TX
        addressToApproveTx(fromTokenAddress, router.address),
        // Swap Tx
        withEstimatedGas(
          router.populateTransaction.swapExactTokensForTokens(
            amountToSwap,
            round(mul(expectedAmountOut, slippageMultiplier), 0),
            path,
            toAddress,
            deadline,
            { gasLimit: '600000', gasPrice }
          )
        )
      )
    } else {
      throw new Error('Unhandled swap type')
    }
  }

  return await Promise.all(txPromises)
}
