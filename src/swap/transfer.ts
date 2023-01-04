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
} from '../swap-helpers'
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
  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      if (
        request.fromWallet.currencyInfo.pluginId !==
          request.toWallet.currencyInfo.pluginId ||
        request.fromCurrencyCode !== request.toCurrencyCode
      ) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      }

      const fetchSwapQuoteInner = async (
        requestInner: EdgeSwapRequestPlugin
      ): Promise<SwapOrder> => {
        const {
          publicAddress: toAddress
        } = await requestInner.toWallet.getReceiveAddress()

        const spendInfo = {
          currencyCode: requestInner.fromCurrencyCode,
          spendTargets: [
            {
              nativeAmount: requestInner.nativeAmount,
              publicAddress: toAddress
            }
          ],
          swapData: {
            isEstimate: false,
            plugin: { ...swapInfo },
            payoutAddress: toAddress,
            payoutCurrencyCode: requestInner.fromCurrencyCode,
            payoutNativeAmount: requestInner.nativeAmount, // Wrong
            payoutWalletId: requestInner.toWallet.id
          }
        }

        const order = {
          request: requestInner,
          spendInfo,
          pluginId
        }

        return order
      }

      const { request: newRequest } = await getMaxSwappable(
        fetchSwapQuoteInner,
        request
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      const quote = await makeSwapPluginQuote(swapOrder)
      return quote
    }
  }

  return out
}
