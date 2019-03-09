// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  SwapCurrencyError
} from 'edge-core-js/types'

import { getFetchJson } from '../react-native-io.js'
import { makeSwapPluginQuote } from '../swap-helpers.js'

const swapInfo = {
  pluginName: 'totle',
  displayName: 'Totle',

  quoteUri: 'https://services.totlesystem.com/orders/suggestions/v0-5-5',
  supportEmail: 'support@totle.com'
}

const swapUri = 'https://services.totlesystem.com/orders/suggestions/v0-5-5'
const tokenUri = 'https://services.totlesystem.com/suggester/tokens'
const expirationMs = 1000 * 60 * 20

type TradeSummary = {
  token: string,
  exchange: string,
  price: string,
  amount: string,
  fee: string
}

type QuoteInfo = {
  id: string,
  contractAddress: string,
  ethValue: string,
  summary: {
    sells: Array<TradeSummary>,
    buys: Array<TradeSummary>
  },
  payload: {
    data: string
  },
  gas: {
    price: string,
    limit: string,
    strict: boolean
  }
}

async function getAddress (
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

function checkReply (reply: Object, request?: EdgeSwapRequest) {
  if (reply.success === false) {
    throw new Error('Totle error: ' + reply.message)
  }
}

export function makeTotlePlugin (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const fetchJson = getFetchJson(opts)

  const { affiliateContract } = initOptions

  async function call (json: any) {
    const body = JSON.stringify({
      ...json,
      affiliateContract
    })

    io.console.info('Totle call:', json)
    const headers = {
      'Content-Type': 'application/json'
    }
    const reply = await fetchJson(swapUri, { method: 'POST', body, headers })
    if (!reply.ok) {
      throw new Error(`Totle returned error code ${reply.status}`)
    }
    const out = reply.json
    io.console.info('Totle swap reply:', out)
    return out
  }

  async function fetchTokens () {
    const reply = await fetchJson(tokenUri, { method: 'GET' })
    if (!reply.ok) {
      throw new Error(`Totle returned error code ${reply.status}`)
    }
    const out = reply.json.tokens
    io.console.info('Totle token reply:', out)
    return out
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote (
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      const tokens = await fetchTokens()

      let fromTokenAddress
      let toTokenAddress
      const fromToken = tokens.find((t) => t.symbol === request.fromCurrencyCode)
      const toToken = tokens.find((t) => t.symbol === request.toCurrencyCode)
      if (request.fromCurrencyCode === 'ETH') {
        fromTokenAddress = '0x0000000000000000000000000000000000000000'
        toTokenAddress = toToken.address
      } else if (request.toCurrencyCode === 'ETH') {
        fromTokenAddress = fromToken.address
        toTokenAddress = '0x0000000000000000000000000000000000000000'
      } else if (!fromToken || !toToken) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      } else {
        fromTokenAddress = fromToken.address
        toTokenAddress = toToken.address
      }

      // Grab addresses:
      const [fromAddress, toAddress] = await Promise.all([
        getAddress(request.fromWallet, request.fromCurrencyCode),
        getAddress(request.toWallet, request.toCurrencyCode)
      ])

      // Swap the currencies if we need a reverse quote:
      const quoteParams =
        request.quoteFor === 'from'
          ? {
            from: fromTokenAddress,
            to: toTokenAddress
          }
          : {
            from: toTokenAddress,
            to: fromTokenAddress
          }

      // Get the estimate from the server:
      const reply = await call({
        address: fromAddress,
        affiliateContract,
        swap: {
          ...quoteParams,
          amount: request.nativeAmount,
          minFillPercent: 97,
          minSlippagePercent: 2
        }
      })
      // TODO: check
      checkReply(reply)

      const quoteInfo: QuoteInfo = reply.response

      let fromNativeAmount = request.nativeAmount
      let toNativeAmount = '0'
      if (quoteInfo.summary.sells) {
        let fromAmount = '0'
        for (const { amount } of quoteInfo.summary.sells) {
          fromAmount = (Number(fromAmount) + Number(amount)).toString()
        }
        fromNativeAmount = fromAmount
      }
      if (quoteInfo.summary.buys) {
        for (const { amount } of quoteInfo.summary.buys) {
          toNativeAmount = (Number(toNativeAmount) + Number(amount)).toString()
        }
      }

      // Make the transaction:
      const spendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            nativeAmount: quoteInfo.ethValue,
            publicAddress: quoteInfo.contractAddress,
            otherParams: {
              pluginName: swapInfo.pluginName,
              uniqueIdentifier: quoteInfo.id,
              data: quoteInfo.payload.data
            }
          }
        ],
        networkFeeOption: 'custom',
        customNetworkFee: {
          gasLimit: quoteInfo.gas.limit,
          gasPrice: quoteInfo.gas.price
        }
      }
      io.console.info('Totle spendInfo', spendInfo)
      const tx = await request.fromWallet.makeSpend(spendInfo)
      tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      tx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        'totle',
        new Date(Date.now() + expirationMs),
        quoteInfo.id
      )
    }
  }

  return out
}
