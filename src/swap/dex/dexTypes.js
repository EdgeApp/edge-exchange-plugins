import { ethers, Transaction } from 'ethers'

// @flow
export type CachedPairData = {
  tokenAddresses: string[],
  lpAddress: string
}

export type RouterTxProviderMap = {
  swapExactETHForTokens: (
    minReceivedTokens?: ethers.BigNumber
  ) => Promise<Transaction>,
  swapExactTokensForETH: (
    minReceivedEth?: ethers.BigNumber
  ) => Promise<Transaction>,
  swapExactTokensForTokens: (
    minReceivedTokens?: ethers.BigNumber
  ) => Promise<Transaction>
}
