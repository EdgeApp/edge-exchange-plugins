import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import { getInOutTokenAddresses } from '../../defiUtils'
import { getFtmProvider, makeTombSwapRouterContract } from '../uniV2Contracts'
import {
  getSwapAmounts,
  getSwapTransactions,
  makeUniV2EdgeSwapQuote
} from '../uniV2Utils'

const EXPIRATION_MS = 1000 * 60
const SLIPPAGE = '0.05'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'tombSwap',
  displayName: 'TombSwap',
  supportEmail: 'support@edge.app'
}

export function makeTombSwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const provider = getFtmProvider(opts.initOptions.quiknodeApiKey)

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
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
        throw new Error(`${swapInfo.displayName}: Mismatched wallet chain`)

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
      const tombSwapRouter = makeTombSwapRouterContract(provider)
      const { amountToSwap, expectedAmountOut } = await getSwapAmounts(
        tombSwapRouter,
        quoteFor,
        request.nativeAmount,
        fromTokenAddress,
        toTokenAddress,
        isWrappingSwap
      )

      // Generate swap transactions
      const toAddress = (await toWallet.getReceiveAddress()).publicAddress
      const expirationDate = new Date(Date.now() + EXPIRATION_MS)
      const deadline = Math.round(expirationDate.getTime() / 1000) // unix timestamp
      const swapTxs = await getSwapTransactions(
        provider,
        request,
        tombSwapRouter,
        amountToSwap,
        expectedAmountOut,
        toAddress,
        SLIPPAGE,
        deadline
      )

      const fromAddress = (await fromWallet.getReceiveAddress()).publicAddress
      const pluginId = swapInfo.pluginId
      // toEdgeUnsignedTxs
      const edgeUnsignedTxs = await Promise.all(
        swapTxs.map(async swapTx => {
          // Convert to our spendInfo
          const edgeSpendInfo: EdgeSpendInfo = {
            currencyCode: request.fromCurrencyCode, // what is being sent out, only if token. Blank if not token
            spendTargets: [
              {
                nativeAmount:
                  swapTx.value != null ? swapTx.value.toString() : '0', // biggy/number string integer
                publicAddress: swapTx.to,

                otherParams: {
                  data: swapTx.data
                }
              }
            ],
            customNetworkFee: {
              gasPrice:
                swapTx.gasPrice != null
                  ? ethers.utils.formatUnits(swapTx.gasPrice, 'gwei').toString()
                  : '0',
              gasLimit: swapTx.gasLimit?.toString() ?? '0'
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
      return makeUniV2EdgeSwapQuote(
        request,
        amountToSwap.toString(),
        expectedAmountOut.toString(),
        edgeUnsignedTxs,
        pluginId,
        swapInfo.displayName,
        true,
        expirationDate
      )
    }
  }

  return out
}
