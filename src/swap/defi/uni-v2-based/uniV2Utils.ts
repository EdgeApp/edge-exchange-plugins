import { mul, sub } from 'biggystring'
import {
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeTransaction
} from 'edge-core-js/types'
import { BigNumber, Contract, ethers, PopulatedTransaction } from 'ethers'

import { round } from '../../../util/biggystringplus'
import { getMetaTokenAddress } from '../defiUtils'
import { makeErc20Contract, makeWethContract } from './uniV2Contracts'
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
  swapRequest: EdgeSwapRequest,
  router: Contract,
  amountToSwap: string,
  expectedAmountOut: string,
  toAddress: string,
  slippage: string,
  deadline: number,
  wethAddress: string
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

  const gasPrice = await provider.getGasPrice()

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
        makeWethContract(provider, wethAddress).populateTransaction.deposit({
          gasLimit: '51000',
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
      makeWethContract(provider, wethAddress).populateTransaction.withdraw(
        amountToSwap,
        {
          gasLimit: '51000',
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

/**
 * Generate the quote with approve() method
 * */
export function makeUniV2EdgeSwapQuote(
  request: EdgeSwapRequest,
  fromNativeAmount: string,
  toNativeAmount: string,
  txs: EdgeTransaction[],
  pluginId: string,
  displayName: string,
  isEstimate: boolean = false,
  expirationDate?: Date
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
    pluginId,
    expirationDate,
    isEstimate,
    async approve(opts): Promise<EdgeSwapResult> {
      let swapTx
      let index = 0
      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i]
        if (txs.length > 1 && i === 0) {
          // This is an approval transaction. Tag with some unfortunately non-translatable data but better than nothing
          tx.metadata = {
            name: displayName,
            category: 'expense:Token Approval'
          }
        } else {
          // This is the swap transaction
          tx.metadata = { ...opts?.metadata, ...tx.metadata }
        }
        // for (const tx of txs) {
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
      if (swapTx == null) throw new Error(`No ${pluginId} swapTx generated.`)
      return {
        transaction: swapTx,
        orderId: swapTx.txid
      }
    },

    async close() {}
  }
  return out
}
