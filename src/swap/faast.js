// @flow

import { gt, lt } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeFetchResponse,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { makeSwapPluginQuote } from '../swap-helpers.js'

const INVALID_CURRENCY_CODES = []

const pluginId = 'faast'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  pluginName: pluginId, // Deprecated
  displayName: 'Faa.st',

  quoteUri: 'https://faa.st/app/orders/',
  supportEmail: 'support@faa.st'
}

const API_PREFIX = 'https://api.faa.st/api/v2/public'

type FaastQuoteJson = {
  swap_id: string,
  created_at: string,
  deposit_address: string,
  deposit_address_extra_id?: string,
  deposit_amount: number,
  deposit_currency: string,
  spot_price: number,
  price: number,
  price_locked_at: string,
  price_locked_until: string,
  withdrawal_amount: number,
  withdrawal_address: string,
  withdrawal_address_extra_id?: string,
  withdrawal_currency: string,
  refund_address?: string,
  refund_address_extra_id?: string,
  user_id?: string,
  terms?: string
}

type FaastAddressJson = {
  valid: boolean,
  blockchain: string,
  standardized: string,
  terms?: string
}

const dontUseLegacy = {
  DGB: true
}

async function getAddress(wallet: EdgeCurrencyWallet, currencyCode: string) {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeFaastPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { initOptions, io, log } = opts

  let affiliateOptions = {}
  if (initOptions.affiliateId == null) {
    log('No affiliateId provided.')
  } else {
    const { affiliateId, affiliateMargin } = initOptions
    affiliateOptions = {
      affiliate_id: affiliateId,
      affiliate_margin: affiliateMargin
    }
  }

  async function checkReply(uri: string, reply: EdgeFetchResponse) {
    let replyJson
    try {
      replyJson = await reply.json()
    } catch (e) {
      throw new Error(
        `Faast ${uri} returned error code ${reply.status} (no JSON)`
      )
    }
    log('reply', replyJson)

    // Faast is not available in some parts of the world:
    if (
      reply.status === 403 &&
      replyJson != null &&
      /geo/.test(replyJson.error)
    ) {
      throw new SwapPermissionError(swapInfo, 'geoRestriction')
    }

    // Anything else:
    if (!reply.ok || (replyJson != null && replyJson.error != null)) {
      throw new Error(
        `Faast ${uri} returned error code ${
          reply.status
        } with JSON ${JSON.stringify(replyJson)}`
      )
    }

    return replyJson
  }

  async function get(path) {
    const uri = `${API_PREFIX}${path}`
    const reply = await io.fetch(uri)
    return checkReply(uri, reply)
  }

  async function post(path, body): Object {
    const uri = `${API_PREFIX}${path}`
    log('request', path, body)
    const reply = await io.fetch(uri, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    return checkReply(uri, reply)
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
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
      if (
        toCurrencyCode === fromCurrencyCode ||
        INVALID_CURRENCY_CODES.includes(toCurrencyCode) ||
        INVALID_CURRENCY_CODES.includes(fromCurrencyCode)
      ) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      log('request', request)

      let fromCurrency
      let toCurrency
      let geoInfo
      try {
        ;[fromCurrency, toCurrency, geoInfo] = await Promise.all([
          get(`/currencies/${fromCurrencyCode}`),
          get(`/currencies/${toCurrencyCode}`),
          get('/geoinfo/')
        ])
      } catch (e) {
        if (/not supported/.test(e.message)) {
          throw new SwapCurrencyError(
            swapInfo,
            fromCurrencyCode,
            toCurrencyCode
          )
        }
        throw e
      }
      if (!(fromCurrency.deposit && toCurrency.receive)) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      if (
        geoInfo.blocked ||
        (geoInfo.restricted &&
          (fromCurrency.restricted || toCurrency.restricted))
      ) {
        throw new SwapPermissionError(swapInfo, 'geoRestriction')
      }

      // Grab addresses:
      const fromAddress = await getAddress(fromWallet, fromCurrencyCode)
      const toAddress = await getAddress(toWallet, toCurrencyCode)

      // Ensure the address format can be handled:
      const [
        fromAddressData: FaastAddressJson,
        toAddressData: FaastAddressJson
      ] = await Promise.all([
        post('/address', { address: fromAddress, currency: fromCurrencyCode }),
        post('/address', { address: toAddress, currency: toCurrencyCode })
      ])
      if (!fromAddressData.valid || !toAddressData.valid) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Figure out amount:
      let quoteAmount
      let amount
      if (quoteFor === 'from') {
        amount = await fromWallet.nativeToDenomination(
          nativeAmount,
          fromCurrencyCode
        )
        quoteAmount = { deposit_amount: Number.parseFloat(amount) }
      } else {
        amount = await toWallet.nativeToDenomination(
          nativeAmount,
          toCurrencyCode
        )
        quoteAmount = { withdrawal_amount: Number.parseFloat(amount) }
      }

      // Check for minimum / maximum:
      log('amount', amount)
      const query = `?${
        quoteFor === 'from' ? 'deposit' : 'withdrawal'
      }_amount=${amount}`
      log('query', query)
      let pairInfo
      try {
        pairInfo = await get(
          `/price/${fromCurrencyCode}_${toCurrencyCode}${query}`
        )
      } catch (e) {
        if (/not currently supported/.test(e.message)) {
          throw new SwapCurrencyError(
            swapInfo,
            fromCurrencyCode,
            toCurrencyCode
          )
        }
        throw e
      }

      let nativeMax
      let nativeMin
      if (quoteFor === 'from') {
        ;[nativeMax, nativeMin] = await Promise.all([
          pairInfo.maximum_deposit
            ? fromWallet.denominationToNative(
                pairInfo.maximum_deposit.toString(),
                fromCurrencyCode
              )
            : null,
          typeof pairInfo.minimum_deposit === 'number'
            ? fromWallet.denominationToNative(
                pairInfo.minimum_deposit.toString(),
                fromCurrencyCode
              )
            : null
        ])
      } else {
        ;[nativeMax, nativeMin] = await Promise.all([
          pairInfo.maximum_withdrawal
            ? toWallet.denominationToNative(
                pairInfo.maximum_withdrawal.toString(),
                toCurrencyCode
              )
            : null,
          typeof pairInfo.minimum_withdrawal === 'number'
            ? toWallet.denominationToNative(
                pairInfo.minimum_withdrawal.toString(),
                toCurrencyCode
              )
            : null
        ])
      }
      if (nativeMin != null && lt(nativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }
      if (nativeMax != null && gt(nativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(swapInfo, nativeMax)
      }

      const body: Object = {
        deposit_currency: fromCurrencyCode,
        withdrawal_currency: toCurrencyCode,
        refund_address: fromAddressData.standardized,
        withdrawal_address: toAddressData.standardized,
        ...quoteAmount,
        ...affiliateOptions
      }

      let quoteData: FaastQuoteJson
      try {
        quoteData = await post('/swap', body)
      } catch (e) {
        // TODO: Using the nativeAmount here is technically a bug,
        // since we don't know the actual limit in this case:
        if (/amount less than/.test(e.message)) {
          throw new SwapBelowLimitError(swapInfo, nativeMin || nativeAmount)
        }
        if (/is greater/.test(e.message)) {
          throw new SwapAboveLimitError(swapInfo, nativeMax || nativeAmount)
        }
        throw e
      }

      const fromNativeAmount = await fromWallet.denominationToNative(
        quoteData.deposit_amount.toString(),
        fromCurrencyCode
      )
      const toNativeAmount = await toWallet.denominationToNative(
        quoteData.withdrawal_amount.toString(),
        toCurrencyCode
      )

      const spendTarget = {
        nativeAmount: quoteFor === 'to' ? fromNativeAmount : nativeAmount,
        publicAddress: quoteData.deposit_address,
        otherParams: {
          uniqueIdentifier: quoteData.deposit_address_extra_id
        }
      }

      const spendInfo = {
        currencyCode: fromCurrencyCode,
        spendTargets: [spendTarget]
      }

      log('spendInfo', spendInfo)
      const tx: EdgeTransaction = await fromWallet.makeSpend(spendInfo)
      if (tx.otherParams == null) tx.otherParams = {}
      tx.otherParams.payinAddress = spendTarget.publicAddress
      tx.otherParams.uniqueIdentifier = spendTarget.otherParams.uniqueIdentifier

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddressData.standardized,
        'faast',
        false,
        new Date(quoteData.price_locked_until),
        quoteData.swap_id
      )
    }
  }

  return out
}
