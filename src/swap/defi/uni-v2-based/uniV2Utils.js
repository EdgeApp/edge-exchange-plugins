// @flow

import { JsonRpcProvider } from '@ethersproject/providers'
import { mul, sub } from 'biggystring'
import {
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeSwapResult,
  type EdgeTransaction
} from 'edge-core-js/types'
import { type Contract, type PopulatedTransaction, ethers } from 'ethers'

import { round } from '../../../util/biggystringplus.js'
import { getMetaTokenAddress } from '../defiUtils.js'
import { makeErc20Contract, makeWrappedFtmContract } from './uniV2Contracts.js'
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

/**
 * Get smart contract transaction(s) necessary to swap based on swap params
 */
export const getSwapTransactions = async (
  provider: JsonRpcProvider,
  swapRequest: EdgeSwapRequest,
  router: Contract,
  amountToSwap: string,
  expectedAmountOut: string,
  toAddress: string,
  slippage: string,
  deadline: number
): Promise<PopulatedTransaction[]> => {
  const { fromWallet, fromCurrencyCode, toCurrencyCode } = swapRequest
  const {
    currencyCode: nativeCurrencyCode,
    metaTokens
  } = fromWallet.currencyInfo
  const fromAddress = (await fromWallet.getReceiveAddress()).publicAddress

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

  const gasPrice = await provider.getGasPrice()

  const addressToApproveTxs = async (
    tokenAddress: string,
    contractAddress: string
  ): PopulatedTransaction | void => {
    const tokenContract = makeErc20Contract(provider, tokenAddress)
    const allowence = await tokenContract.allowance(
      fromAddress,
      contractAddress
    )
    if (allowence.sub(amountToSwap).lt(0)) {
      return tokenContract.populateTransaction.approve(
        contractAddress,
        ethers.constants.MaxUint256,
        { gasLimit: '60000', gasPrice }
      )
    }
  }

  const txs = await (async (): Promise<
    Array<Promise<PopulatedTransaction> | void>
  > => {
    // Deposit native currency for wrapped token
    if (isFromNativeCurrency && isToWrappedCurrency) {
      return [
        makeWrappedFtmContract.populateTransaction.deposit({
          gasLimit: '51000',
          gasPrice,
          value: amountToSwap
        })
      ]
    }
    // Withdraw wrapped token for native currency
    if (isFromWrappedCurrency && isToNativeCurrency) {
      return [
        // Deposit Tx
        makeWrappedFtmContract.populateTransaction.withdraw(amountToSwap, {
          gasLimit: '51000',
          gasPrice
        })
      ]
    }
    // Swap native currency for token

    const slippageMultiplier = sub('1', slippage)
    if (isFromNativeCurrency && !isToNativeCurrency) {
      return [
        // Swap Tx
        router.populateTransaction.swapExactETHForTokens(
          round(mul(expectedAmountOut, slippageMultiplier)),
          path,
          toAddress,
          deadline,
          { gasLimit: '250000', gasPrice, value: amountToSwap }
        )
      ]
    }
    // Swap token for native currency
    if (!isFromNativeCurrency && isToNativeCurrency) {
      return [
        // Approve TX
        await addressToApproveTxs(path[0], router.address),
        // Swap Tx
        router.populateTransaction.swapExactTokensForETH(
          amountToSwap,
          round(mul(expectedAmountOut, slippageMultiplier)),
          path,
          toAddress,
          deadline,
          { gasLimit: '250000', gasPrice }
        )
      ]
    }
    // Swap token for token
    if (!isFromNativeCurrency && !isToNativeCurrency) {
      return [
        // Approve TX
        await addressToApproveTxs(path[0], router.address),
        // Swap Tx
        router.populateTransaction.swapExactTokensForTokens(
          amountToSwap,
          round(mul(expectedAmountOut, slippageMultiplier)),
          path,
          toAddress,
          deadline,
          { gasLimit: '600000', gasPrice }
        )
      ]
    }

    throw new Error('Unhandled swap type')
  })()

  return await Promise.all(txs.filter(tx => tx != null))
}

/**
 * Generate the quote with approve() method
 * */
export function makeUniV2EdgeSwapQuote(
  request: EdgeSwapRequest,
  fromNativeAmount: string,
  toNativeAmount: string,
  txs: EdgeTransaction[],
  toAddress: string,
  pluginId: string,
  isEstimate: boolean = false,
  expirationDate?: Date,
  quoteId?: string
): EdgeSwapQuote {
  const { fromWallet } = request
  const swapTx = txs[txs.length - 1]

  const out: EdgeSwapQuote = {
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount:
        swapTx.parentNetworkFee != null
          ? swapTx.parentNetworkFee
          : swapTx.networkFee
    },
    toAddress,
    pluginId,
    expirationDate,
    quoteId,
    isEstimate,
    async approve(): Promise<EdgeSwapResult> {
      let swapTx
      let index = 0
      for (const tx of txs) {
        const signedTransaction = await fromWallet.signTx(tx)
        // NOTE: The swap transaction will always be the last one
        swapTx = await fromWallet.broadcastTx(signedTransaction)
        const lastTransactionIndex = txs.length - 1
        // if it's the last transaction of the array then assign `nativeAmount` data
        // (after signing and broadcasting) for metadata purposes
        if (index === lastTransactionIndex) {
          tx.nativeAmount = `-${fromNativeAmount}`
        }
        await fromWallet.saveTx(signedTransaction)
        index++
      }
      if (!swapTx) throw new Error(`No ${pluginId} swapTx generated.`)
      return {
        transaction: swapTx,
        orderId: swapTx.txid,
        toAddress
      }
    },

    async close() {}
  }
  return out
}
