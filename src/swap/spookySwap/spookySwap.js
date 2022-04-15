// @flow

import { mul, sub } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeMetaToken,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeSwapResult,
  type EdgeTransaction
} from 'edge-core-js/types'
import { type PopulatedTransaction, ethers } from 'ethers'

import { round } from '../../util/biggystringplus.js'
import {
  makeErc20Contract,
  provider,
  spookySwapRouter,
  wrappedFtmToken
} from './spookyContracts.js'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'spookySwap',
  displayName: 'SpookySwap',
  supportEmail: '',
  supportUrl: 'https://discord.com/invite/weXbvPAH4Q'
}
const expirationMs = 1000 * 20 * 60
const SLIPPAGE = '0.05' // 5%
const SLIPPAGE_MULTIPLIER = sub('1', SLIPPAGE)

export function makeSpookySwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { log } = opts

  const getMetaTokenAddress = (
    metaTokens: EdgeMetaToken[],
    tokenCurrencyCode: string
  ): string => {
    const metaToken = metaTokens.find(
      mt => mt.currencyCode === tokenCurrencyCode
    )

    if (metaToken == null || metaToken?.contractAddress === undefined)
      throw new Error(
        'Could not find contract address for ' + tokenCurrencyCode
      )

    return metaToken.contractAddress ?? ''
  }

  const getSwapTransactions = async (
    swapRequest: EdgeSwapRequest,
    amountToSwap: string,
    expectedAmountOut: string,
    toAddress: string,
    deadline: number
  ): Promise<PopulatedTransaction[]> => {
    const {
      fromWallet,
      toWallet,
      fromCurrencyCode,
      toCurrencyCode
    } = swapRequest
    const currencyInfo = fromWallet.currencyInfo
    const fromAddress = (await fromWallet.getReceiveAddress()).publicAddress

    // Sanity check: Both wallets should be of the same chain.
    if (
      fromWallet.currencyInfo.currencyCode !==
      toWallet.currencyInfo.currencyCode
    )
      throw new Error('SpookySwap: Mismatched wallet chain')

    // TODO: Use our new denom implementation to get native amounts
    const nativeCurrencyCode = currencyInfo.currencyCode
    const wrappedCurrencyCode = `W${nativeCurrencyCode}`
    const isFromNativeCurrency = fromCurrencyCode === nativeCurrencyCode
    const isToNativeCurrency = toCurrencyCode === nativeCurrencyCode
    const isFromWrappedCurrency = fromCurrencyCode === wrappedCurrencyCode
    const isToWrappedCurrency = toCurrencyCode === wrappedCurrencyCode

    // TODO: Do different wallets share the same custom metaTokens?
    const metaTokens: EdgeMetaToken[] = currencyInfo.metaTokens

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
      const tokenContract = makeErc20Contract(tokenAddress)
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
          wrappedFtmToken.populateTransaction.deposit({
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
          wrappedFtmToken.populateTransaction.withdraw(amountToSwap, {
            gasLimit: '51000',
            gasPrice
          })
        ]
      }
      // Swap native currency for token
      if (isFromNativeCurrency && !isToNativeCurrency) {
        return [
          // Swap Tx
          spookySwapRouter.populateTransaction.swapExactETHForTokens(
            round(mul(expectedAmountOut, SLIPPAGE_MULTIPLIER)),
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
          await addressToApproveTxs(path[0], spookySwapRouter.address),
          // Swap Tx
          spookySwapRouter.populateTransaction.swapExactTokensForETH(
            amountToSwap,
            round(mul(expectedAmountOut, SLIPPAGE_MULTIPLIER)),
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
          await addressToApproveTxs(path[0], spookySwapRouter.address),
          // Swap Tx
          spookySwapRouter.populateTransaction.swapExactTokensForTokens(
            amountToSwap,
            round(mul(expectedAmountOut, SLIPPAGE_MULTIPLIER)),
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

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      log.warn(JSON.stringify(request, null, 2))
      const {
        fromWallet,
        toWallet,
        fromCurrencyCode,
        toCurrencyCode,
        quoteFor
      } = request

      // Sanity check: Both wallets should be of the same chain.
      if (
        fromWallet.currencyInfo.currencyCode !==
        toWallet.currencyInfo.currencyCode
      )
        throw new Error('SpookySwap: Mismatched wallet chain')

      // Parse input/output token addresses. If either from or to swap sources
      // are for the native currency, convert the address to the wrapped equivalent.
      const nativeCurrencyCode = fromWallet.currencyInfo.currencyCode
      const wrappedCurrencyCode = `W${nativeCurrencyCode}`
      const isFromNativeCurrency = fromCurrencyCode === nativeCurrencyCode
      const isToNativeCurrency = toCurrencyCode === nativeCurrencyCode
      const isFromWrappedCurrency = fromCurrencyCode === wrappedCurrencyCode
      const isToWrappedCurrency = toCurrencyCode === wrappedCurrencyCode
      const isWrappingSwap =
        (isFromNativeCurrency && isToWrappedCurrency) ||
        (isFromWrappedCurrency && isToNativeCurrency)
      const metaTokens: EdgeMetaToken[] = fromWallet.currencyInfo.metaTokens

      const fromTokenAddress = getMetaTokenAddress(
        metaTokens,
        isFromNativeCurrency ? wrappedCurrencyCode : fromCurrencyCode
      )
      const toTokenAddress = getMetaTokenAddress(
        metaTokens,
        isToNativeCurrency ? wrappedCurrencyCode : toCurrencyCode
      )

      // Calculate amounts
      const path = [fromTokenAddress, toTokenAddress]
      const [amountToSwap, expectedAmountOut] = (isWrappingSwap
        ? [request.nativeAmount, request.nativeAmount]
        : quoteFor === 'to'
        ? await spookySwapRouter.getAmountsIn(request.nativeAmount, path)
        : quoteFor === 'from'
        ? await spookySwapRouter.getAmountsOut(request.nativeAmount, path)
        : []
      ).map(String)

      if (!amountToSwap || !expectedAmountOut)
        throw new Error(`Unknown quote direction ${quoteFor}`)

      const fromAddress = (await fromWallet.getReceiveAddress()).publicAddress
      const toAddress = (await toWallet.getReceiveAddress()).publicAddress

      const expirationDate = new Date(Date.now() + expirationMs)
      const deadline = Math.round(expirationDate.getTime() / 1000) // unix timestamp

      const swapTxs = await getSwapTransactions(
        request,
        amountToSwap,
        expectedAmountOut,
        toAddress,
        deadline
      )

      const edgeUnsignedTxs = await Promise.all(
        swapTxs.map(async swapTx => {
          // Convert to our spendInfo
          const edgeSpendInfo: EdgeSpendInfo = {
            pluginId: 'spookySwap',
            currencyCode: request.fromCurrencyCode, // what is being sent out, only if token. Blank if not token
            spendTargets: [
              {
                nativeAmount: swapTx.value ? swapTx.value.toString() : '0', // biggy/number string integer
                publicAddress: swapTx.to,

                otherParams: {
                  data: swapTx.data
                }
              }
            ],
            customNetworkFee: {
              gasPrice: ethers.utils
                .formatUnits(swapTx.gasPrice, 'gwei')
                .toString(),
              gasLimit: swapTx.gasLimit.toString()
            },
            networkFeeOption: 'custom',
            swapData: {
              isEstimate: false,
              payoutAddress: toAddress,
              payoutCurrencyCode: request.toCurrencyCode,
              payoutNativeAmount: expectedAmountOut.toString(),
              payoutWalletId: request.toWallet.id,
              plugin: { ...swapInfo },
              refundAddress: fromAddress
            }
          }

          const edgeUnsignedTx: EdgeTransaction = await request.fromWallet.makeSpend(
            edgeSpendInfo
          )

          return edgeUnsignedTx
        })
      )

      // Convert that to the output format:
      return makeSpookySwapPluginQuote(
        request,
        amountToSwap.toString(),
        expectedAmountOut.toString(),
        edgeUnsignedTxs,
        toAddress,
        'spookySwap',
        true,
        expirationDate
      )
    }
  }

  return out
}

export function makeSpookySwapPluginQuote(
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
      if (!swapTx) throw new Error('No Totle swapTx')
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
