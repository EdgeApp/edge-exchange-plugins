import {
  EdgeCorePluginOptions,
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
} from '../util/swapHelpers'
import { convertRequest } from '../util/utils'
import { EdgeSwapRequestPlugin } from './types'

const pluginId = 'transfer'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Transfer',
  orderUri: undefined,
  supportEmail: 'support@edge.com'
}

export function makeTransferPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const {
      publicAddress: toAddress
    } = await request.toWallet.getReceiveAddress({
      tokenId: null
    })

    const spendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          publicAddress: toAddress
        }
      ],
      swapData: {
        isEstimate: false,
        payoutAddress: toAddress,
        plugin: { ...swapInfo },
        payoutCurrencyCode: request.toCurrencyCode,
        payoutNativeAmount: request.nativeAmount,
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
        request.fromWallet.currencyInfo.pluginId !==
          request.toWallet.currencyInfo.pluginId ||
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
