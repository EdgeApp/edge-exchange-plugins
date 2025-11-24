import { fromBech32 } from '@cosmjs/encoding'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest } from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'cosmosibc',
  displayName: 'Cosmos IBC',
  orderUri: undefined,
  isDex: true,
  supportEmail: 'support@edge.com'
}

export function makeCosmosIbcPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const {
      publicAddress: fromAddress
    } = await request.fromWallet.getReceiveAddress({
      tokenId: request.fromTokenId
    })
    const {
      publicAddress: toAddress
    } = await request.toWallet.getReceiveAddress({ tokenId: request.toTokenId })

    // Make sure both plugins are Cosmos-based
    try {
      fromBech32(fromAddress)
      fromBech32(toAddress)
    } catch (e) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          publicAddress: toAddress
        }
      ],
      assetAction: {
        assetActionType: 'transfer'
      },
      swapData: {
        isEstimate: false,
        payoutAddress: toAddress,
        plugin: { ...swapInfo },
        payoutCurrencyCode: request.toCurrencyCode,
        payoutTokenId: request.toTokenId,
        payoutNativeAmount: request.nativeAmount,
        payoutWalletId: request.toWallet.id
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        isEstimate: false,
        canBePartial: false,
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: request.nativeAmount
        },
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: request.nativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: request.toWallet.id
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: request.nativeAmount
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      if (
        request.fromWallet.currencyInfo.pluginId ===
          request.toWallet.currencyInfo.pluginId ||
        // keep currencyCode comparison because this plugin is to transfer assets between chains
        request.fromCurrencyCode !== request.toCurrencyCode
      ) {
        throw new SwapCurrencyError(swapInfo, request)
      }

      const newRequest = await getMaxSwappable(fetchSwapQuoteInner, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
