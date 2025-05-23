import { add, gt, lt, sub } from 'biggystring'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'
import { BigNumber, ethers, PopulatedTransaction } from 'ethers'

import {
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import {
  asyncWaterfall,
  convertRequest,
  getAddress,
  shuffleArray
} from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'
import ABI from './abi/FANTOM_SONIC_BRIDGE'

const pluginId = 'fantomsonicbridge'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Fantom/Sonic Bridge',
  orderUri: undefined,
  supportEmail: 'support@edge.com'
}

export function makeFantomSonicBridgePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const rpcs = [
    'https://rpcapi.fantom.network',
    'https://rpc3.fantom.network',
    'https://rpc.fantom.network',
    'https://rpc2.fantom.network',
    'https://1rpc.io/ftm',
    'https://fantom-rpc.publicnode.com'
  ]
  const bridgeContractAddress = '0x3561607590e28e0848ba3b67074c676d6d1c9953'

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const fromAddress = await getAddress(request.fromWallet)
    const toAddress = await getAddress(request.toWallet)

    if (fromAddress !== toAddress) {
      throw new Error('From and to addresses must be the same')
    }

    const providers = rpcs.map(rpc => new ethers.providers.JsonRpcProvider(rpc))

    const call = async (method: string, args: string[] = []): Promise<any> => {
      return await asyncWaterfall(
        shuffleArray(providers).map(provider => async () => {
          const contract = new ethers.Contract(
            bridgeContractAddress,
            ABI,
            provider
          )
          return await (contract[method](...args) as Promise<any>)
        }),
        1000
      )
    }

    const depositFee: BigNumber = await call('depositFee')

    let fantomAmount: string
    let sonicAmount: string
    if (request.quoteFor === 'to') {
      fantomAmount = add(request.nativeAmount, depositFee.toString())
      sonicAmount = request.nativeAmount
    } else {
      fantomAmount = request.nativeAmount
      sonicAmount = sub(request.nativeAmount, depositFee.toString())
    }

    const minAmount: BigNumber = await call('minDepositAmount')
    if (lt(fantomAmount, minAmount.toString())) {
      throw new SwapBelowLimitError(swapInfo, minAmount.toString(), 'from')
    }

    const maxAmount: BigNumber = await call('maxDepositAmount')
    if (gt(fantomAmount, maxAmount.toString())) {
      throw new SwapAboveLimitError(swapInfo, maxAmount.toString(), 'from')
    }

    const transaction: PopulatedTransaction = await new ethers.Contract(
      bridgeContractAddress,
      ABI
    ).populateTransaction.deposit(depositFee)
    if (transaction.data == null) {
      throw new Error('failed to create transaction data')
    }

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fantomAmount,
          publicAddress: bridgeContractAddress
        }
      ],
      memos: [{ type: 'hex', value: transaction.data.replace(/^0x/, '') }],
      assetAction: {
        assetActionType: 'swap'
      },
      networkFeeOption: 'custom',
      customNetworkFee: {
        gasLimit: '60000'
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        isEstimate: false,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: sonicAmount
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: fantomAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: request.toWallet.id
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: fantomAmount
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      if (
        request.fromWallet.currencyInfo.pluginId !== 'fantom' ||
        request.toWallet.currencyInfo.pluginId !== 'sonic' ||
        request.fromTokenId !== null ||
        request.toTokenId !== null
      ) {
        throw new SwapCurrencyError(swapInfo, request)
      }

      const newRequest = await getMaxSwappable(fetchSwapQuoteInner, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
