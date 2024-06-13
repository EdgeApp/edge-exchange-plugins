import { mul } from 'biggystring'
import {
  EdgeCorePluginFactory,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapResult
} from 'edge-core-js/types'

import { ZeroXApi } from './api'
import { asInitOptions } from './types'
import { getTokenAddress } from './util'

const EXPIRATION_MS = 1000 * 60
/** [The ERC-7528: ETH (Native Asset) Address Convention](https://eips.ethereum.org/EIPS/eip-7528) */
const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const swapInfo: EdgeSwapInfo = {
  displayName: '0x Swap',
  pluginId: 'zeroxswap',
  supportEmail: 'support@edge.app'
}

export const make0xSwap: EdgeCorePluginFactory = (opts): EdgeSwapPlugin => {
  const { io } = opts
  const initOptions = asInitOptions(opts.initOptions)

  const api = new ZeroXApi(io, initOptions.apiKey)

  return {
    swapInfo,
    fetchSwapQuote: async (
      swapRequest,
      userSettings,
      opts
    ): Promise<EdgeSwapQuote> => {
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
      const fromCurrencyCode = swapRequest.fromWallet.currencyInfo.currencyCode
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
      const apiQuote = await api.quote(apiEndpoint, {
        sellToken: fromTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        buyToken: toTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        [amountField]: swapRequest.nativeAmount
      })

      return {
        approve: async (
          opts?: EdgeSwapApproveOptions
        ): Promise<EdgeSwapResult> => {
          throw new Error('Approve not yet implemented')
        },
        close: async () => {},
        expirationDate: new Date(Date.now() + EXPIRATION_MS),
        fromNativeAmount: apiQuote.sellAmount,
        isEstimate: false,
        networkFee: {
          currencyCode: fromCurrencyCode,
          nativeAmount: mul(apiQuote.gas, apiQuote.gasPrice)
        },
        pluginId: swapInfo.pluginId,
        request: swapRequest,
        swapInfo: swapInfo,
        toNativeAmount: apiQuote.buyAmount
      }
    }
  }
}
