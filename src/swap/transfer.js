// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'

import { makeSwapPluginQuote } from '../swap-helpers.js'

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
  const { log } = opts

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapQuote> {
      if (
        request.fromWallet.currencyInfo.pluginId !==
        request.toWallet.currencyInfo.pluginId
      ) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      }

      const {
        publicAddress: toAddress
      } = await request.toWallet.getReceiveAddress()

      const tx: EdgeTransaction = await request.fromWallet.makeSpend({
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: request.nativeAmount,
            publicAddress: toAddress
          }
        ]
      })

      const quote = makeSwapPluginQuote(
        request,
        request.nativeAmount,
        request.nativeAmount,
        tx,
        toAddress,
        'transfer'
      )
      log(quote)
      return quote
    }
  }

  return out
}
