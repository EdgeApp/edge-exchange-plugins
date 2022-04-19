// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeSwapResult,
  type EdgeTransaction
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import { getInOutTokenAddresses } from '../defi/defiUtils.js'
import { spookySwapRouter } from '../defi/uni-v2-based/uniV2Contracts.js'
import {
  getSwapAmounts,
  getSwapTransactions
} from '../defi/uni-v2-based/uniV2Utils.js'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'spookySwap',
  displayName: 'SpookySwap',
  supportEmail: '',
  supportUrl: 'https://discord.com/invite/weXbvPAH4Q'
}
const EXPIRATION_MS = 1000 * 20 * 60
const SLIPPAGE = '0.05' // 5%

export function makeSpookySwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { log } = opts

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
      const {
        fromTokenAddress,
        toTokenAddress,
        isWrappingSwap
      } = getInOutTokenAddresses(
        fromWallet.currencyInfo,
        fromCurrencyCode,
        toCurrencyCode
      )

      // Calculate swap amounts
      const { amountToSwap, expectedAmountOut } = await getSwapAmounts(
        spookySwapRouter,
        quoteFor,
        request.nativeAmount,
        fromTokenAddress,
        toTokenAddress,
        isWrappingSwap
      )

      // Generate swap transactions
      const fromAddress = (await fromWallet.getReceiveAddress()).publicAddress
      const toAddress = (await toWallet.getReceiveAddress()).publicAddress
      const expirationDate = new Date(Date.now() + EXPIRATION_MS)
      const deadline = Math.round(expirationDate.getTime() / 1000) // unix timestamp
      const swapTxs = await getSwapTransactions(
        request,
        spookySwapRouter,
        amountToSwap,
        expectedAmountOut,
        toAddress,
        SLIPPAGE,
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
