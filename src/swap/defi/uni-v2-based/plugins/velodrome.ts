import { gt } from 'biggystring'
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
import VELODROME_V1_ROUTER_ABI from '../../abi/VELODROME_V1_ROUTER_ABI'
import VELODROME_V2_ROUTER_ABI from '../../abi/VELODROME_V2_ROUTER_ABI'
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
const VELODROME_V1_ROUTER_ADDRESS = '0x9c12939390052919aF3155f41Bf4160Fd3666A6f'
const VELODROME_V2_ROUTER_ADDRESS = '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858'
const VELODROME_V2_FACTORY_ADDRESS =
  '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a'

interface VelodromeConfig {
  path: any
  router: ethers.Contract
}

export function makeVelodromePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    uid: string
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet, fromTokenId, toTokenId } = request

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
    const velodromeRouterV1 = new ethers.Contract(
      VELODROME_V1_ROUTER_ADDRESS,
      VELODROME_V1_ROUTER_ABI,
      provider
    )
    const velodromeRouterV2 = new ethers.Contract(
      VELODROME_V2_ROUTER_ADDRESS,
      VELODROME_V2_ROUTER_ABI,
      provider
    )

    const configs: VelodromeConfig[] = [
      // V1
      {
        path: [[fromTokenAddress, toTokenAddress, true]],
        router: velodromeRouterV1
      },
      {
        path: [[fromTokenAddress, toTokenAddress, false]],
        router: velodromeRouterV1
      },
      // V2
      {
        path: [
          [fromTokenAddress, toTokenAddress, true, VELODROME_V2_FACTORY_ADDRESS]
        ],
        router: velodromeRouterV2
      },
      {
        path: [
          [
            fromTokenAddress,
            toTokenAddress,
            false,
            VELODROME_V2_FACTORY_ADDRESS
          ]
        ],
        router: velodromeRouterV2
      }
    ]

    // Try stable and volatile pools form both routers and choose the best one.
    const getAmounts = async (
      config: VelodromeConfig
    ): Promise<{
      path: any
      router: ethers.Contract
      amountToSwap: string
      expectedAmountOut: string
    }> => {
      try {
        const amounts = await getSwapAmounts(
          config.router,
          request,
          swapInfo,
          config.path,
          isWrappingSwap
        )
        return { ...config, ...amounts }
      } catch (e) {
        return {
          ...config,
          amountToSwap: '0',
          expectedAmountOut: '0'
        }
      }
    }

    const amounts = await Promise.all(
      configs.map(async config => await getAmounts(config))
    )
    const best = amounts.sort((a, b) =>
      gt(a.expectedAmountOut, b.expectedAmountOut) ? -1 : 1
    )[0]

    const { amountToSwap, expectedAmountOut, router, path } = best
    if (expectedAmountOut === '0') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Generate swap transactions
    const toAddress = (await toWallet.getReceiveAddress({ tokenId: null }))
      .publicAddress
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
      router,
      wrappedEthContract,
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
        networkFeeOption: 'custom',
        assetAction: {
          assetActionType: 'swap'
        },
        savedAction: {
          actionType: 'swap',
          swapInfo,
          isEstimate: false,
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
          contractAddress: router.address
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
        isEstimate: false,
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
