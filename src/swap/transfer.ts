import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'

import { makeSwapPluginQuote } from '../swap-helpers'

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
      userSettings: Object | undefined
    ): Promise<EdgeSwapQuote> {
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
