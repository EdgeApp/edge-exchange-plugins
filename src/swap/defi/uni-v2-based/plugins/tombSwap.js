// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import { getInOutTokenAddresses } from '../../defiUtils.js'
import {
  getFtmProvider,
  makeTombSwapRouterContract
} from '../uniV2Contracts.js'
import {
  getSwapAmounts,
  getSwapTransactions,
  makeUniV2EdgeSwapQuote
} from '../uniV2Utils.js'

const EXPIRATION_MS = 1000 * 20 * 60
const SLIPPAGE = '0.05'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'tombSwap',
  displayName: 'TombSwap',
  supportEmail: '',
  supportUrl: 'https://discord.gg/vANnESmVdz'
}

export function makeTombSwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const provider = getFtmProvider(opts.initOptions.quiknodeApiKey)

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
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
            pluginId,
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
      return makeUniV2EdgeSwapQuote(
        request,
        amountToSwap.toString(),
        expectedAmountOut.toString(),
        edgeUnsignedTxs,
        toAddress,
        pluginId,
        true,
        expirationDate
      )
    }
  }

  return out
}
