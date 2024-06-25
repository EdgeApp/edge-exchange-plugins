import { add } from 'biggystring'
import {
  EdgeCorePluginFactory,
  EdgeNetworkFee,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapQuote,
  EdgeSwapResult
} from 'edge-core-js/types'

import { EXPIRATION_MS, NATIVE_TOKEN_ADDRESS } from './constants'
import { asInitOptions } from './types'
import { getCurrencyCode, getTokenAddress } from './util'
import { ZeroXApi } from './ZeroXApi'

const swapInfo: EdgeSwapInfo = {
  displayName: '0x Gasless Swap',
  pluginId: '0xgasless',
  supportEmail: 'support@edge.app'
}

export const make0xGaslessPlugin: EdgeCorePluginFactory = opts => {
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

      // From wallet address
      const {
        publicAddress: fromWalletAddress
      } = await swapRequest.fromWallet.getReceiveAddress({
        tokenId: swapRequest.fromTokenId
      })

      // Amount request parameter/field name to use in the quote request
      const amountField =
        swapRequest.quoteFor === 'from' ? 'sellAmount' : 'buyAmount'

      // Get quote from ZeroXApi
      const chainId = api.getChainIdFromPluginId(
        swapRequest.fromWallet.currencyInfo.pluginId
      )
      const apiSwapQuote = await api.gaslessSwapQuote(chainId, {
        sellToken: fromTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        buyToken: toTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        takerAddress: fromWalletAddress,
        [amountField]: swapRequest.nativeAmount
      })

      if (!apiSwapQuote.liquidityAvailable)
        throw new Error('No liquidity available')

      const { gasFee, zeroExFee } = apiSwapQuote.fees

      if (
        gasFee.feeToken.toLocaleLowerCase() !==
          fromTokenAddress?.toLocaleLowerCase() ||
        zeroExFee.feeToken.toLocaleLowerCase() !==
          fromTokenAddress?.toLocaleLowerCase()
      ) {
        throw new Error(
          'Quoted fees must be in the same token as the from token in the swap request'
        )
      }

      const fromCurrencyCode = getCurrencyCode(
        swapRequest.fromWallet,
        swapRequest.fromTokenId
      )
      const networkFee: EdgeNetworkFee = {
        currencyCode: fromCurrencyCode,
        nativeAmount: add(gasFee.feeAmount, zeroExFee.feeAmount)
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
