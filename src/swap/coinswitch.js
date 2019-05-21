// @flow

import { add, div, gt, lt, mul, sub } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { getFetchJson } from '../react-native-io.js'
import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo = {
  pluginName: 'coinswitch',
  displayName: 'CoinSwitch',
  quoteUri: 'https://coinswitch.co/app/exchange/transaction/',
  supportEmail: 'support@coinswitch.co'
}

const uri = 'https://api.coinswitch.co/'
const expirationMs = 60 * 60 * 12 * 1000

type QuoteInfo = {
  orderId: string,
  exchangeAddress: {
    address: string,
    tag: string
  },
  expectedDepositCoinAmount: number,
  expectedDestinationCoinAmount: number
}

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

function checkReply (reply: Object, request?: EdgeSwapRequest) {
  if (request != null && !reply.data) {
    throw new SwapCurrencyError(
      swapInfo,
      request.fromCurrencyCode,
      request.toCurrencyCode
    )
  }
  if (!reply.success) {
    throw new Error(JSON.stringify(reply.code))
  }
}

export function makeCoinSwitchPlugin (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const fetchJson = getFetchJson(opts)

  if (initOptions.apiKey == null) {
    throw new Error('No coinswitch apiKey provided.')
  }
  const { apiKey } = initOptions

  async function call (json: any) {
    const body = JSON.stringify(json.params)
    io.console.info('coinswitch call:', json)
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    }
    const api = uri + json.route
    const reply = await fetchJson(api, { method: 'POST', body, headers })
    if (!reply.ok) {
      throw new Error(`CoinSwitch returned error code ${reply.status}`)
    }
    const out = await reply.json
    io.console.info('coinswitch fixed reply:', out)
    return out
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote (
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(request.fromWallet, request.fromCurrencyCode),
        getAddress(request.toWallet, request.toCurrencyCode)
      ])

      const quoteAmount =
        request.quoteFor === 'from'
          ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            request.fromCurrencyCode
          )
          : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            request.toCurrencyCode
          )

      const quoteParams =
        request.quoteFor === 'from'
          ? {
            depositCoin: request.fromCurrencyCode,
            destinationCoin: request.toCurrencyCode,
            depositCoinAmount: quoteAmount
          }
          : {
            depositCoin: request.fromCurrencyCode,
            destinationCoin: request.toCurrencyCode,
            destinationCoinAmount: quoteAmount
          }

      const quoteReplies = await Promise.all([
        call({
          route: 'v2/rate',
          params: {
            depositCoin: quoteParams.depositCoin.toLowerCase(),
            destinationCoin: quoteParams.destinationCoin.toLowerCase()
          }
        })
      ])

      checkReply(quoteReplies[0], request)

      let fromAmount, fromNativeAmount, toNativeAmount
      const minerFee = quoteReplies[0].data.minerFee.toString()
      const rate = quoteReplies[0].data.rate.toString()

      if (request.quoteFor === 'from') {
        fromAmount = quoteAmount
        fromNativeAmount = request.nativeAmount
        const exchangeAmountBeforeMinerFee = mul(rate, quoteAmount)
        const exchangeAmount = sub(exchangeAmountBeforeMinerFee, minerFee)
        toNativeAmount = await request.toWallet.denominationToNative(
          exchangeAmount,
          request.toCurrencyCode
        )
      } else {
        const exchangeAmountAfterMinerFee = add(quoteAmount, minerFee)
        fromAmount = div(exchangeAmountAfterMinerFee, rate, 16)

        fromNativeAmount = await request.fromWallet.denominationToNative(
          fromAmount,
          request.fromCurrencyCode
        )
        toNativeAmount = request.nativeAmount
      }

      const [nativeMin, nativeMax] = await Promise.all([
        request.fromWallet.denominationToNative(
          quoteReplies[0].data.limitMinDepositCoin.toString(),
          request.fromCurrencyCode
        ),
        request.fromWallet.denominationToNative(
          quoteReplies[0].data.limitMaxDepositCoin.toString(),
          request.fromCurrencyCode
        )
      ])

      if (lt(fromNativeAmount, nativeMin)) {
        throw new SwapBelowLimitError(swapInfo, nativeMin)
      }

      if (gt(fromNativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(swapInfo, nativeMax)
      }

      const createOrder = await call({
        route: 'v2/order',
        params: {
          depositCoin: quoteParams.depositCoin.toLowerCase(),
          destinationCoin: quoteParams.destinationCoin.toLowerCase(),
          depositCoinAmount: parseFloat(fromAmount),
          destinationAddress: { address: toAddress, tag: null },
          refundAddress: { address: fromAddress, tag: null }
        }
      })

      checkReply(createOrder)
      const quoteInfo: QuoteInfo = createOrder.data

      // Make the transaction:
      const spendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: fromNativeAmount,
            publicAddress: quoteInfo.exchangeAddress.address,
            otherParams: {
              uniqueIdentifier: quoteInfo.exchangeAddress.tag
            }
          }
        ]
      }
      io.console.info('coinswitch spendInfo', spendInfo)
      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)
      if (!tx.otherParams) tx.otherParams = {}
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'coinswitch',
        true,
        new Date(Date.now() + expirationMs),
        quoteInfo.orderId
      )
    }
  }

  return out
}
