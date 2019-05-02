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

      const quoteAmount = await fromWallet.nativeToDenomination(
        nativeAmount,
        fromCurrencyCode
      )

      async function get (path: string) {
        const api = `${uri}${path}`
        const reply = await fetchJson(api)
        return reply.json
      }

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

      const currencies = await get('swap/currencies')
      let fromCorrect = false
      let toCorrect = false
      if (!(currencies === null || currencies.result === null)) {
        for (const curr of currencies.result) {
          io.console.info(
            `curr.id [${curr.id}] - curr.canDeposit [${
              curr.canDeposit
            }] - curr.canReceive [${curr.canReceive}]`
          )
          if (curr.id === fromCurrencyCode && curr.canDeposit === 1) {
            fromCorrect = true
          }

          if (curr.id === toCurrencyCode && curr.canReceive === 1) {
            toCorrect = true
          }
        }
      }

      if (!fromCorrect || !toCorrect) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

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

      const receiveAmount = await fromWallet.denominationToNative(
        swapRate.result.finalAmount,
        fromCurrencyCode
      )

      const swapParams = {
        destination: toAddress,
        refund: fromAddress,
        from: fromCurrencyCode,
        to: toCurrencyCode,
        amount: quoteAmount,
        affiliateID: initOptions.affiliateId,
        affiliateFee: initOptions.affiliateFee.toString()
      }

      const swap = await post('swap/create', swapParams)

      if (!swap.success) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      let swapStatus = {
        result: {
          deposit_addr_default: ''
        }
      }
      // Poll until error or pending deposit
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

      io.console.info('CoinZark spendInfo', spendInfo)
      const tx = await request.fromWallet.makeSpend(spendInfo)
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

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
