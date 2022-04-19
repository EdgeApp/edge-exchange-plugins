// @flow

import { type Contract } from 'ethers'

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
) => {
  const path = [fromTokenAddress, toTokenAddress]
  const [amountToSwap, expectedAmountOut] = (isWrappingSwap
    ? [nativeAmount, nativeAmount]
    : quoteFor === 'to'
    ? await router.getAmountsIn(nativeAmount, path)
    : quoteFor === 'from'
    ? await router.getAmountsOut(nativeAmount, path)
    : []
  ).map(String)

  if (!amountToSwap || !expectedAmountOut)
    throw new Error(`Failed to calculate amounts`)

  return { amountToSwap, expectedAmountOut }
}
