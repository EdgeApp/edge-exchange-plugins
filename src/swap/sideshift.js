// @flow

import { div, gt, lt, mul } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSpendInfo,
  type EdgeSpendTarget,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapPluginStatus,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
} from 'edge-core-js/types'

import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo = {
  pluginName: 'sideshift',
  displayName: 'SideShift AI',
  quoteUri: 'https://sideshift.ai/orders/',
  supportEmail: 'support@sideshift.ai'
}

const API_PREFIX = 'https://sideshift.ai/api/'

type SideShiftQuoteJson = {
  error?: string,
  success?: {
    pair: string,
    withdrawal: string,
    withdrawalAmount: string,
    deposit: string,
    depositAmount: string,
    expiration: number,
    quotedRate: string,
    apiPubKey: string,
    minerFee: string,
    maxLimit: number,
    orderId: string,
    sAddress?: string
  }
}

const dontUseLegacy = {
  DGB: true
}

async function getAddress (wallet: EdgeCurrencyWallet, currencyCode: string) {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeSideShiftPlugin (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, initOptions } = opts

  if (initOptions.testerId == null) {
    throw new Error('No SideShift testerId provided')
  }
  const { testerId } = initOptions

  async function checkReply (uri: string, reply: Response) {
    let replyJson
    try {
      replyJson = await reply.json()
    } catch (e) {
      throw new Error(
        `SideShift ${uri} returned error code ${reply.status} (no JSON)`
      )
    }
    io.console.info('sideshift reply', replyJson)

    // SideShift is not available in some parts of the world:
    if (
      reply.status === 403 &&
      replyJson != null &&
      replyJson.error != null &&
      replyJson.error.code === 'geoRestriction'
    ) {
      throw new SwapPermissionError(swapInfo, 'geoRestriction')
    }

    // Anything else:
    if (!reply.ok || (replyJson != null && replyJson.error != null)) {
      throw new Error(
        `Shapeshift ${uri} returned error code ${
          reply.status
        } with JSON ${JSON.stringify(replyJson)}`
      )
    }

    return replyJson
  }

  async function get (path) {
    const uri = `${API_PREFIX}${path}`
    const reply = await io.fetch(uri)
    return checkReply(uri, reply)
  }

  async function post (path, body, accessToken: string): Object {
    const uri = `${API_PREFIX}${path}`
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

    async fetchSwapQuote (
      request: EdgeSwapRequest
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

      // Check for supported assets:
      const json = await get(`/facts/`)
      const fromStatus = json[fromCurrencyCode.toUpperCase()]
      const toStatus = json[toCurrencyCode.toUpperCase()]
      if (
        fromStatus == null ||
        toStatus == null ||
        fromStatus.status !== 'available' ||
        toStatus.status !== 'available'
      ) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Grab addresses:
      const fromAddress = await getAddress(fromWallet, fromCurrencyCode)
      const toAddress = await getAddress(toWallet, toCurrencyCode)

      // here we are going to get multipliers
      const multiplierFrom = await fromWallet.denominationToNative(
        '1',
        fromCurrencyCode
      )
      const multiplierTo = await fromWallet.denominationToNative(
        '1',
        toCurrencyCode
      )

      // Figure out amount:
      const quoteAmount =
        quoteFor === 'from'
          ? { depositAmount: div(nativeAmount, multiplierFrom, 16) }
          : { amount: div(nativeAmount, multiplierTo, 16) }
      const body: Object = {
        testerId,
        pair: `${fromCurrencyCode}_${toCurrencyCode}`,
        returnAddress: fromAddress,
        withdrawal: toAddress,
        ...quoteAmount
      }

      let quoteData: ShapeShiftQuoteJson
      try {
        quoteData = await post('/sendamount', body, accessToken)
      } catch (e) {
        // TODO: Using the nativeAmount here is technically a bug,
        // since we don't know the actual limit in this case:
        if (/is below/.test(e.message)) {
          throw new SwapBelowLimitError(swapInfo, nativeAmount)
        }
        if (/is greater/.test(e.message)) {
          throw new SwapAboveLimitError(swapInfo, nativeAmount)
        }
        throw e
      }
      if (!quoteData.success) {
        throw new Error('Did not get back successful quote')
      }

      const exchangeData = quoteData.success
      const fromNativeAmount = mul(exchangeData.depositAmount, multiplierFrom)
      const toNativeAmount = mul(exchangeData.withdrawalAmount, multiplierTo)

      const spendTarget: EdgeSpendTarget = {
        nativeAmount: quoteFor === 'to' ? fromNativeAmount : nativeAmount,
        publicAddress: exchangeData.deposit
      }

      // Adjust the spendInfo if we need to provide a tag:
      if (exchangeData.deposit.indexOf('?dt=') !== -1) {
        const splitArray = exchangeData.deposit.split('?dt=')
        spendTarget.publicAddress = splitArray[0]
        spendTarget.otherParams = {
          uniqueIdentifier: splitArray[1]
        }
      }
      if (fromCurrencyCode === 'XMR' && exchangeData.sAddress) {
        spendTarget.publicAddress = exchangeData.sAddress
        spendTarget.otherParams = {
          uniqueIdentifier: exchangeData.deposit
        }
      }

      const spendInfo: EdgeSpendInfo = {
        // networkFeeOption: spendInfo.networkFeeOption,
        currencyCode: fromCurrencyCode,
        spendTargets: [spendTarget]
      }
      io.console.info('shapeshift spendInfo', spendInfo)
      const tx: EdgeTransaction = await fromWallet.makeSpend(spendInfo)
      if (tx.otherParams == null) tx.otherParams = {}
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier = spendInfo.spendTargets[0].otherParams
        ? spendInfo.spendTargets[0].otherParams.uniqueIdentifier
        : ''

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'shapeshift',
        false,
        new Date(exchangeData.expiration),
        exchangeData.orderId
      )
    }
  }

  return out
}
