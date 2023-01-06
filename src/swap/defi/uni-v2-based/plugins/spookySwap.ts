import { asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  JsonObject
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import {
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../../../swap-helpers'
import { convertRequest } from '../../../../util/utils'
import { EdgeSwapRequestPlugin } from '../../../types'
import { getInOutTokenAddresses } from '../../defiUtils'
import { getFtmProvider, makeSpookySwapRouterContract } from '../uniV2Contracts'
import { getSwapAmounts, getSwapTransactions } from '../uniV2Utils'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'spookySwap',
  displayName: 'SpookySwap',
  supportEmail: 'support@edge.app'
}

const asInitOptions = asObject({
  quiknodeApiKey: asOptional(asString)
})

const EXPIRATION_MS = 1000 * 60
const SLIPPAGE = '0.05'

export function makeSpookySwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { quiknodeApiKey } = asInitOptions(opts.initOptions)
  const provider = getFtmProvider(quiknodeApiKey)

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      const fetchSwapQuoteInner = async (
        requestInner: EdgeSwapRequestPlugin,
        customNetworkFee?: JsonObject
      ): Promise<SwapOrder> => {
        const {
          fromWallet,
          toWallet,
          fromCurrencyCode,
          toCurrencyCode,
          quoteFor
        } = requestInner

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
        const spookySwapRouter = makeSpookySwapRouterContract(provider)
        const { amountToSwap, expectedAmountOut } = await getSwapAmounts(
          spookySwapRouter,
          quoteFor,
          requestInner.nativeAmount,
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
          provider,
          requestInner,
          spookySwapRouter,
          amountToSwap,
          expectedAmountOut,
          toAddress,
          SLIPPAGE,
          deadline,
          customNetworkFee?.gasPrice
        )

        const pluginId = swapInfo.pluginId
        const edgeSpendInfos = swapTxs.map(swapTx => {
          // Convert to our spendInfo
          const edgeSpendInfo: EdgeSpendInfo = {
            currencyCode: requestInner.fromCurrencyCode, // what is being sent out, only if token. Blank if not token
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
              gasLimits: swapTx.gasLimit?.toString() ?? '0'
            },
            networkFeeOption: 'custom',
            swapData: {
              isEstimate: false,
              payoutAddress: toAddress,
              payoutCurrencyCode: requestInner.toCurrencyCode,
              payoutNativeAmount: expectedAmountOut.toString(),
              payoutWalletId: requestInner.toWallet.id,
              plugin: { ...swapInfo },
              refundAddress: fromAddress
            }
          }

          return edgeSpendInfo
        })

        let spendInfo = edgeSpendInfos[0]
        let preTx: EdgeTransaction | undefined
        if (edgeSpendInfos.length > 1) {
          spendInfo = edgeSpendInfos[1]
          edgeSpendInfos[0].metadata = { category: 'expense:Token Approval' }
          preTx = await requestInner.fromWallet.makeSpend(edgeSpendInfos[0])
        }

        const order = {
          request: requestInner,
          spendInfo,
          pluginId,
          expirationDate,
          preTx
        }

        return order
      }

      const { request: newRequest, customNetworkFee } = await getMaxSwappable(
        fetchSwapQuoteInner,
        request
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest, customNetworkFee)
      return await makeSwapPluginQuote({ ...swapOrder, customNetworkFee })
    }
  }
  return out
}
