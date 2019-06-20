// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { getFetchJson } from '../react-native-io.js'
import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo = {
  pluginName: 'coinzark',
  displayName: 'CoinZark',
  supportEmail: 'support@coinzark.com'
}

const expirationMs = 84600 * 60 * 60 * 1000

const uri = 'https://www.coinzark.com/api/v2/'

const dontUseLegacy = {
  DGB: true
}

async function getAddress (
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeCoinZarkPlugin (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, initOptions } = opts
  const fetchJson = getFetchJson(opts)

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

      if (quoteFor !== 'from') {
        // CoinZark does not support reverse quotes
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(fromWallet, fromCurrencyCode),
        getAddress(toWallet, toCurrencyCode)
      ])

      // Convert amount to CoinZark supported format
      const quoteAmount = await fromWallet.nativeToDenomination(
        nativeAmount,
        fromCurrencyCode
      )

      // Convenience function to get JSON from the API
      async function get (path: string) {
        const api = `${uri}${path}`
        const reply = await fetchJson(api)
        return reply.json
      }

      // Convenience function to post form values and get returned JSON from the API
      async function post (url, values: any) {
        const opts = {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
          },
          method: 'POST',
          body: ''
        }
        const formData = new URLSearchParams()
        for (const prop in values) {
          if (!values.hasOwnProperty(prop)) continue
          formData.append(prop, values[prop])
        }
        opts.body = formData.toString()
        const reply = await fetchJson(`${uri}${url}`, opts)
        const out = reply.json
        return out
      }

      // Fetch the supported currencies
      const currencies = await get('swap/currencies')
      let fromCorrect = false
      let toCorrect = false

      // Loop through the currencies and find the requested ones.
      // CoinZark will return canDeposit / canReceive as status of the
      // coins. The coin we want to exchange from should have canDeposit enabled
      // and the coin we want to exchange to should have canReceive enabled.
      if (currencies != null && currencies.result != null) {
        for (const curr of currencies.result) {
          if (curr.id === fromCurrencyCode && curr.canDeposit === 1) {
            fromCorrect = true
          }

          if (curr.id === toCurrencyCode && curr.canReceive === 1) {
            toCorrect = true
          }
        }
      }

      // Check if we managed to match the requested coin types
      // and that they are properly available. If not return an error.
      if (!fromCorrect || !toCorrect) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Fetch the rate from CoinZark. This also includes the limits.
      const swapRate = await get(
        'swap/rate?from=' +
          fromCurrencyCode +
          '&to=' +
          toCurrencyCode +
          '&amount=' +
          quoteAmount +
          '&affiliateID=' +
          initOptions.affiliateId +
          '&affiliateFee=' +
          initOptions.affiliateFee.toString()
      )

      const nativeMin = await request.fromWallet.denominationToNative(
        swapRate.result.minimumDeposit,
        fromCurrencyCode
      )

      const nativeMax = await request.fromWallet.denominationToNative(
        swapRate.result.maximumDeposit,
        fromCurrencyCode
      )

      // If the final amount is 0, there is something wrong. Probably the limits.
      if (swapRate.result.finalAmount === 0) {
        if (
          parseFloat(swapRate.result.depositAmount) <
          parseFloat(swapRate.result.minimumDeposit)
        ) {
          throw new SwapBelowLimitError(swapInfo, nativeMin)
        }

        if (
          parseFloat(swapRate.result.depositAmount) >
          parseFloat(swapRate.result.maximumDeposit)
        ) {
          throw new SwapAboveLimitError(swapInfo, nativeMax)
        }

        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Convert the receive amount to native
      const receiveAmount = await fromWallet.denominationToNative(
        swapRate.result.finalAmount,
        fromCurrencyCode
      )

      // Configure the form parameters for the Swap create call
      const swapParams = {
        destination: toAddress,
        refund: fromAddress,
        from: fromCurrencyCode,
        to: toCurrencyCode,
        amount: quoteAmount,
        affiliateID: initOptions.affiliateId,
        affiliateFee: initOptions.affiliateFee.toString()
      }

      // Create the swap
      const swap = await post('swap/create', swapParams)

      // Check if the creation was succesful, otherwise return an error
      if (!swap.success) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      let swapStatus = {
        result: {
          deposit_addr_default: ''
        }
      }

      // Poll the status until there's an error or the swap is
      // awaiting the deposit
      while (true) {
        swapStatus = await get('swap/status?uuid=' + swap.result.uuid)

        if (
          !swapStatus.success ||
          swapStatus.result.swap_status === 'cancelled'
        ) {
          throw new SwapCurrencyError(
            swapInfo,
            fromCurrencyCode,
            toCurrencyCode
          )
        }

        if (swapStatus.result.swap_status === 'awaitingDeposit') {
          break
        }

        // Wait for one second
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      const spendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: request.nativeAmount,
            publicAddress: swapStatus.result.deposit_addr_default,
            otherParams: {
              uniqueIdentifier: swap.result.uuid
            }
          }
        ]
      }

      io.console.info('CoinZark spendinfo:', spendInfo)

      // Build the transaction the user has to approve to
      // initiate the swap
      const tx = await request.fromWallet.makeSpend(spendInfo)
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      // Return the quote to the user for execution
      return makeSwapPluginQuote(
        request,
        request.nativeAmount,
        receiveAmount,
        tx,
        toAddress,
        'coinzark',
        new Date(Date.now() + expirationMs),
        swap.result.uuid
      )
    }
  }

  return out
}
