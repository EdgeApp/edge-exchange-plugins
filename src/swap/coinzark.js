// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  SwapCurrencyError
} from 'edge-core-js/types'

import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo = {
  pluginName: 'coinzark',
  displayName: 'CoinZark',
  supportEmail: 'support@coinzark.com'
}

/* type CoinZarkQuoteJson = {
  swap_id: string,
  created_at: string,
  deposit_address: string,
  deposit_amount: number,
  deposit_currency: string,
  spot_price: number,
  price: number,
  price_locked_at: string,
  price_locked_until: string,
  withdrawal_amount: number,
  withdrawal_address: string,
  withdrawal_currency: string,
  refund_address?: string,
  user_id?: string,
  terms?: string
}

const dontUseLegacy = {
  DGB: true
}

async function getAddress (wallet: EdgeCurrencyWallet, currencyCode: string) {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
} */

export function makeCoinZarkPlugin (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, initOptions } = opts

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote (
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      const {
        fromCurrencyCode,
        fromWallet,
        nativeAmount,
        quoteFor,
        toCurrencyCode,
        toWallet
      } = request
      if (toCurrencyCode === fromCurrencyCode) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      io.console.info(initOptions, fromWallet, nativeAmount, quoteFor, toWallet)

      const spendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: '0',
            publicAddress: '',
            otherParams: {
              uniqueIdentifier: ''
            }
          }
        ]
      }
      io.console.info('CoinZark spendInfo', spendInfo)
      const tx = await request.fromWallet.makeSpend(spendInfo)
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        '',
        '',
        tx,
        '',
        'CoinZark',
        new Date(),
        ''
      )
    }
  }

  return out
}
