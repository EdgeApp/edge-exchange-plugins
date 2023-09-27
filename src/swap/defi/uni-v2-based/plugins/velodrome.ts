import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import {
  customFeeCache,
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../../../swap-helpers'
import { convertRequest } from '../../../../util/utils'
import { EdgeSwapRequestPlugin } from '../../../types'
import VELODROME_V1_ROUTER_ABI from '../../abi/VELODROME_V1_ROUTER_ABI'
import WRAPPED_OPTIMISM_ETH_ABI from '../../abi/WRAPPED_OPTIMISM_ETH_ABI'
import { getInOutTokenAddresses } from '../../defiUtils'
import { getSwapAmounts, getSwapTransactions } from '../uniV2Utils'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'velodrome',
  isDex: true,
  displayName: 'Velodrome',
  supportEmail: 'support@edge.app'
}

const EXPIRATION_MS = 1000 * 60
const SLIPPAGE = '0.05'
const OPTIMISM_RPC = 'https://rpc.ankr.com/optimism/'
const WETH_TOKEN_ADDRESS = '0x4200000000000000000000000000000000000006'
const VELODROME_ROUTER_ADDRESS = '0x9c12939390052919aF3155f41Bf4160Fd3666A6f'

export function makeVelodromePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    uid: string
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, fromTokenId, toTokenId, quoteFor } = request

    if (
      // Velodrome does not support reverse quotes
      request.quoteFor === 'to' ||
      // Velodrome only supports Optimism
      fromWallet.currencyInfo.pluginId !== 'optimism' ||
      toWallet.currencyInfo.pluginId !== 'optimism'
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Parse input/output token addresses. If either from or to swap sources
    // are for the native currency, convert the address to the wrapped equivalent.
    const inOutAddresses = getInOutTokenAddresses(
      fromWallet.currencyConfig,
      WETH_TOKEN_ADDRESS,
      fromTokenId,
      toTokenId
    )
    const { fromTokenAddress, toTokenAddress, isWrappingSwap } = inOutAddresses

    const provider = new ethers.providers.JsonRpcProvider(OPTIMISM_RPC)
    // Calculate swap amounts
    const velodromeRouter = new ethers.Contract(
      VELODROME_ROUTER_ADDRESS,
      VELODROME_V1_ROUTER_ABI,
      provider
    )

    // Identify best pool type
    const stable = isWrappingSwap
      ? true // No need to check for wrapping txs since it won't even use the dex
      : await velodromeRouter.getAmountOut(
          request.nativeAmount,
          fromTokenAddress,
          toTokenAddress
        ).stable

    const path = [[fromTokenAddress, toTokenAddress, stable]]

    const { amountToSwap, expectedAmountOut } = await getSwapAmounts(
      velodromeRouter,
      quoteFor,
      request.nativeAmount,
      path,
      isWrappingSwap
    )

    // Generate swap transactions
    const toAddress = (await toWallet.getReceiveAddress()).publicAddress
    const expirationDate = new Date(Date.now() + EXPIRATION_MS)
    const deadline = Math.round(expirationDate.getTime() / 1000) // unix timestamp
    const customNetworkFee = customFeeCache.getFees(uid)
    const wrappedEthContract = new ethers.Contract(
      WETH_TOKEN_ADDRESS,
      WRAPPED_OPTIMISM_ETH_ABI,
      provider
    )
    const swapTxs = await getSwapTransactions(
      provider,
      inOutAddresses,
      path,
      velodromeRouter,
      wrappedEthContract,
      amountToSwap,
      expectedAmountOut,
      toAddress,
      SLIPPAGE,
      deadline,
      customNetworkFee?.gasPrice
    )
    const fromAddress = (await fromWallet.getReceiveAddress()).publicAddress
    // toEdgeUnsignedTxs
    const edgeSpendInfos = swapTxs.map(swapTx => {
      // Convert to our spendInfo
      const edgeSpendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode, // what is being sent out, only if token. Blank if not token
        spendTargets: [
          {
            memo: swapTx.data,
            nativeAmount: swapTx.value != null ? swapTx.value.toString() : '0', // biggy/number string integer
            publicAddress: swapTx.to
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

      return edgeSpendInfo
    })

    let spendInfo = edgeSpendInfos[0]
    let preTx: EdgeTransaction | undefined
    if (edgeSpendInfos.length > 1) {
      spendInfo = edgeSpendInfos[1]
      edgeSpendInfos[0].metadata = { category: 'expense:Token Approval' }
      preTx = await request.fromWallet.makeSpend(edgeSpendInfos[0])
    }

    customFeeCache.setFees(uid, spendInfo.customNetworkFee)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: amountToSwap,
      expirationDate,
      preTx
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      const uid = customFeeCache.createUid()

      const newRequest = await getMaxSwappable(
        fetchSwapQuoteInner,
        request,
        uid
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest, uid)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
