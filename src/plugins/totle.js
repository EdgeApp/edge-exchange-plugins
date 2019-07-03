// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'
import Web3 from 'web3'

import { getFetchJson } from '../react-native-io.js'

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

const ETH_ADDRESS = '0x0000000000000000000000000000000000000000'
const ERC20_ABI = [ { constant: false, inputs: [ { name: '_spender', type: 'address' }, { name: '_value', type: 'uint256' } ], name: 'approve', outputs: [ { name: '', type: 'bool' } ], payable: false, type: 'function' }, { constant: true, inputs: [ { name: '_owner', type: 'address' }, { name: '_spender', type: 'address' } ], name: 'allowance', outputs: [ { name: '', type: 'uint256' } ], payable: false, type: 'function' } ]
const totleTransferProxyAddress = '0x74758AcFcE059f503a7E6B0fC2c8737600f9F2c4'
const provider = new Web3.providers.WebsocketProvider('wss://node.totlesystem.com')
const web3 = new Web3(provider)
const { toBN } = web3.utils

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

      let isFromToken = true
      let fromTokenAddress
      let toTokenAddress
      const fromToken = tokens.find((t) => t.symbol === request.fromCurrencyCode)
      const toToken = tokens.find((t) => t.symbol === request.toCurrencyCode)

      if ((!fromToken && request.fromCurrencyCode !== 'ETH') || (!toToken && request.toCurrencyCode !== 'ETH')) {
        throw new SwapCurrencyError(
          swapInfo,
          request.fromCurrencyCode,
          request.toCurrencyCode
        )
      }

      if (request.fromCurrencyCode === 'ETH') {
        isFromToken = false

        fromTokenAddress = ETH_ADDRESS
        toTokenAddress = toToken.address
      } else if (request.toCurrencyCode === 'ETH') {
        fromTokenAddress = fromToken.address
        toTokenAddress = ETH_ADDRESS
      } else {
        fromTokenAddress = fromToken.address
        toTokenAddress = toToken.address
      }

      // Grab addresses:
      const { publicAddress: fromAddress } = await request.fromWallet.getReceiveAddress({ currencyCode })
      const { publicAddress: toAddress } = await request.toWallet.getReceiveAddress({ currencyCode })

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

      let fromNativeAmount = toBN(request.nativeAmount)
      let toNativeAmount = toBN('0')
      if (request.toCurrencyCode === 'ETH') {
        for (const { amount, price } of quoteInfo.summary.sells) {
          const factor = 10 ** 18
          const ethAmount = toBN(amount).mul(toBN(price * factor)).div(toBN(factor))
          toNativeAmount.iadd(ethAmount)
        }
      } else {
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
      }

      const txs = []

      // Check if source is a token and then check it is approved to sell
      if (isFromToken) {
        const tokenContract = new web3.eth.Contract(ERC20_ABI, fromTokenAddress)
        const allowance = toBN(await tokenContract.methods.allowance(fromAddress, totleTransferProxyAddress).call())
        const zero = toBN(0)

        if (allowance.eq(zero)) {
          const uintMax = toBN(2).pow(toBN(256)).sub(toBN(1)).toString()
          const approveData = tokenContract.methods.approve(totleTransferProxyAddress, uintMax).encodeABI()

          const spendInfo = {
            currencyCode: request.fromCurrencyCode,
            spendTargets: [
              {
                nativeAmount: '0',
                publicAddress: fromTokenAddress,
                otherParams: {
                  data: approveData
                }
              }
            ]
          }

          const approveTx = await request.fromWallet.makeSpend(spendInfo)
          txs.push(approveTx)
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
              uniqueIdentifier: quoteInfo.id,
              data: quoteInfo.payload.data
            }
          }
        ],
        networkFeeOption: 'custom',
        customNetworkFee: {
          gasLimit: quoteInfo.gas.limit,
          gasPrice: String(quoteInfo.gas.price / 1000000000)
        }
      }
      io.console.info('Totle spendInfo', spendInfo)
      const rebalanceTx = await request.fromWallet.makeSpend(spendInfo)
      rebalanceTx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
      rebalanceTx.otherParams.uniqueIdentifier =
        spendInfo.spendTargets[0].otherParams.uniqueIdentifier

      txs.push(rebalanceTx)

      const quote = makeTotleSwapPluginQuote(
        request,
        fromNativeAmount.toString(),
        toNativeAmount.toString(),
        txs,
        toAddress,
        'totle',
        new Date(Date.now() + expirationMs),
        quoteInfo.id,
        io
      )
      io.console.info(quote)
      return quote
    }
  }

  return out
}

function makeTotleSwapPluginQuote (
  request: EdgeSwapRequest,
  fromNativeAmount: string,
  toNativeAmount: string,
  txs: Array<EdgeTransaction>,
  destinationAddress: string,
  pluginName: string,
  expirationDate?: Date,
  quoteId?: string,
  io
): EdgeSwapPluginQuote {
  io.console.info(arguments)
  const { fromWallet } = request
  const swapTx = txs[txs.length - 1]

  const out: EdgeSwapPluginQuote = {
    fromNativeAmount,
    toNativeAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount: swapTx.networkFee
    },
    destinationAddress,
    pluginName,
    expirationDate,
    quoteId,

    async approve (): Promise<EdgeTransaction> {
      let swapTx

      for (const tx of txs) {
        const signedTransaction = await fromWallet.signTx(tx)
        // NOTE: The swap transaction will always be the last one
        swapTx = await fromWallet.broadcastTx(
          signedTransaction
        )
        await fromWallet.saveTx(signedTransaction)
      }

      return swapTx
    },

    async close () {}
  }
  return out
}
