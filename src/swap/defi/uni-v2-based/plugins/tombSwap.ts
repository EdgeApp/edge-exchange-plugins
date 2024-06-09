import { asObject, asOptional, asString } from 'cleaners'
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
} from '../../../../util/swapHelpers'
import { convertRequest } from '../../../../util/utils'
import { EdgeSwapRequestPlugin } from '../../../types'
import { getInOutTokenAddresses, InOutTokenAddresses } from '../../defiUtils'
import {
  getFtmProvider,
  makeTombSwapRouterContract,
  makeWrappedFtmContract,
  WFTM_TOKEN_ADDRESS
} from '../uniV2Contracts'
import { getSwapAmounts, getSwapTransactions } from '../uniV2Utils'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'tombSwap',
  isDex: true,
  displayName: 'TombSwap',
  supportEmail: 'support@edge.app'
}

const asInitOptions = asObject({
  quiknodeApiKey: asOptional(asString)
})

const EXPIRATION_MS = 1000 * 60
const SLIPPAGE = '0.05'

export function makeTombSwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { quiknodeApiKey } = asInitOptions(opts.initOptions)
  const provider = getFtmProvider(quiknodeApiKey)

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    uid: string
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, fromTokenId, toTokenId } = request

    // Sanity check: Both wallets should be of the same chain.
    if (
      fromWallet.currencyInfo.pluginId !== 'fantom' ||
      toWallet.currencyInfo.pluginId !== 'fantom'
    )
      throw new SwapCurrencyError(swapInfo, request)

    // Parse input/output token addresses. If either from or to swap sources
    // are for the native currency, convert the address to the wrapped equivalent.
    const inOutAddresses: InOutTokenAddresses = getInOutTokenAddresses(
      fromWallet.currencyConfig,
      WFTM_TOKEN_ADDRESS,
      fromTokenId,
      toTokenId
    )
    const { fromTokenAddress, toTokenAddress, isWrappingSwap } = inOutAddresses

    // Calculate swap amounts
    const tombSwapRouter = makeTombSwapRouterContract(provider)
    const { amountToSwap, expectedAmountOut } = await getSwapAmounts(
      tombSwapRouter,
      request,
      swapInfo,
      [fromTokenAddress, toTokenAddress],
      isWrappingSwap
    )

    // Generate swap transactions
    const toAddress = (await toWallet.getReceiveAddress({ tokenId: null }))
      .publicAddress
    const expirationDate = new Date(Date.now() + EXPIRATION_MS)
    const deadline = Math.round(expirationDate.getTime() / 1000) // unix timestamp
    const customNetworkFee = customFeeCache.getFees(uid)
    const path = [fromTokenAddress, toTokenAddress]
    const wrappedFtmContract = makeWrappedFtmContract(provider)
    const swapTxs = await getSwapTransactions(
      provider,
      inOutAddresses,
      path,
      tombSwapRouter,
      wrappedFtmContract,
      amountToSwap,
      expectedAmountOut,
      toAddress,
      SLIPPAGE,
      deadline,
      customNetworkFee?.gasPrice
    )

    const fromAddress = (await fromWallet.getReceiveAddress({ tokenId: null }))
      .publicAddress
    // toEdgeUnsignedTxs
    const edgeSpendInfos = swapTxs.map((swapTx, i) => {
      // Convert to our spendInfo
      const edgeSpendInfo: EdgeSpendInfo = {
        tokenId: request.fromTokenId,
        spendTargets: [
          {
            nativeAmount:
              swapTxs.length === 2 && i === 0
                ? '0' // approval transactions don't have a value
                : amountToSwap,
            publicAddress: swapTx.to
          }
        ],
        memos:
          swapTx.data != null
            ? [{ type: 'hex', value: swapTx.data.replace(/^0x/, '') }]
            : undefined,
        customNetworkFee: {
          gasPrice:
            swapTx.gasPrice != null
              ? ethers.utils.formatUnits(swapTx.gasPrice, 'gwei').toString()
              : '0',
          gasLimit: swapTx.gasLimit?.toString() ?? '0'
        },
        networkFeeOption: 'custom'
      }

      return edgeSpendInfo
    })

    let spendInfo = edgeSpendInfos[0]
    let preTx: EdgeTransaction | undefined
    if (edgeSpendInfos.length > 1) {
      spendInfo = edgeSpendInfos[1]
      const approvalSpendInfo: EdgeSpendInfo = {
        ...edgeSpendInfos[0],
        assetAction: {
          assetActionType: 'tokenApproval'
        },
        savedAction: {
          actionType: 'tokenApproval',
          tokenApproved: {
            pluginId: fromWallet.currencyInfo.pluginId,
            tokenId: fromTokenId,
            nativeAmount: amountToSwap
          },
          tokenContractAddress: inOutAddresses.fromTokenAddress,
          contractAddress: tombSwapRouter.address
        }
      }

      preTx = await request.fromWallet.makeSpend(approvalSpendInfo)
    }

    spendInfo = {
      ...spendInfo,
      assetAction: {
        assetActionType: 'swap'
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        isEstimate: true,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: expectedAmountOut.toString()
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: amountToSwap
        },
        payoutAddress: toAddress,
        payoutWalletId: request.toWallet.id,
        refundAddress: fromAddress
      }
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
