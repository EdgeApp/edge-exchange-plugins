import { mul } from 'biggystring'
import {
  EdgeCorePluginFactory,
  EdgeNetworkFee,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapQuote,
  EdgeSwapResult
} from 'edge-core-js/types'

import { ZeroXApi } from './api'
import { EXPIRATION_MS, NATIVE_TOKEN_ADDRESS } from './constants'
import { asInitOptions } from './types'
import { getTokenAddress } from './util'

const swapInfo: EdgeSwapInfo = {
  displayName: '0x Swap',
  pluginId: '0x',
  supportEmail: 'support@edge.app'
}

export const make0xSwapPlugin: EdgeCorePluginFactory = opts => {
  const { io } = opts
  const initOptions = asInitOptions(opts.initOptions)

  const api = new ZeroXApi(io, initOptions.apiKey)

  return {
    swapInfo,
    fetchSwapQuote: async (swapRequest): Promise<EdgeSwapQuote> => {
      // The fromWallet and toWallet must be of the same currency plugin
      // type and therefore of the same network.
      if (
        swapRequest.fromWallet.currencyInfo.pluginId !==
        swapRequest.toWallet.currencyInfo.pluginId
      ) {
        throw new Error('Swap between different networks is not supported')
      }

      const fromTokenAddress = getTokenAddress(
        swapRequest.fromWallet,
        swapRequest.fromTokenId
      )
      const toTokenAddress = getTokenAddress(
        swapRequest.toWallet,
        swapRequest.toTokenId
      )

      if (swapRequest.quoteFor === 'max') {
        throw new Error('Max quotes not supported')
      }

      const amountField =
        swapRequest.quoteFor === 'from' ? 'sellAmount' : 'buyAmount'

      // Get quote from ZeroXApi
      const apiEndpoint = api.getEndpointFromPluginId(
        swapRequest.fromWallet.currencyInfo.pluginId
      )
      const apiSwapQuote = await api.swapQuote(apiEndpoint, {
        sellToken: fromTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        buyToken: toTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        [amountField]: swapRequest.nativeAmount
      })

      const networkFee: EdgeNetworkFee = {
        currencyCode: swapRequest.fromWallet.currencyInfo.currencyCode,
        nativeAmount: mul(apiSwapQuote.gas, apiSwapQuote.gasPrice)
      }

      return {
        approve: async (
          opts?: EdgeSwapApproveOptions
        ): Promise<EdgeSwapResult> => {
          throw new Error('Approve not yet implemented')
        },
        close: async () => {},
        expirationDate: new Date(Date.now() + EXPIRATION_MS),
        fromNativeAmount: apiSwapQuote.sellAmount,
        isEstimate: false,
        networkFee,
        pluginId: swapInfo.pluginId,
        request: swapRequest,
        swapInfo: swapInfo,
        toNativeAmount: apiSwapQuote.buyAmount
      }
    }
  }
}
