import { add, gt, lt, sub } from 'biggystring'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapAddressError,
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
import ABI from './abi/FANTOM_SONIC_UPGRADE'

const pluginId = 'fantomsonicupgrade'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Fantom/Sonic Upgrade',
  isDex: true,
  orderUri: undefined,
  supportEmail: 'support@edge.com'
}

export function makeFantomSonicUpgradePlugin(
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
  const upgradeContractAddress = '0x3561607590e28e0848ba3b67074c676d6d1c9953'

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const fromAddress = await getAddress(request.fromWallet)
    const toAddress = await getAddress(request.toWallet)

    if (fromAddress !== toAddress) {
      throw new SwapAddressError(swapInfo, { reason: 'mustMatch' })
    }

    const providers = rpcs.map(rpc => new ethers.providers.JsonRpcProvider(rpc))

    const call = async (method: string): Promise<BigNumber> => {
      try {
        return await asyncWaterfall(
          shuffleArray(providers).map(provider => async () => {
            const contract = new ethers.Contract(
              upgradeContractAddress,
              ABI,
              provider
            )
            return await (contract[method]() as Promise<BigNumber>)
          }),
          1000
        )
      } catch (error) {
        throw new Error(`Failed to call method ${method}: ${String(error)}`)
      }
    }

    const depositFee = await call('depositFee')

    let fantomAmount: string
    let sonicAmount: string
    if (request.quoteFor === 'to') {
      fantomAmount = add(request.nativeAmount, depositFee.toString())
      sonicAmount = request.nativeAmount
    } else {
      fantomAmount = request.nativeAmount
      sonicAmount = sub(request.nativeAmount, depositFee.toString())
    }

    const minAmount = await call('minDepositAmount')
    if (lt(fantomAmount, minAmount.toString())) {
      throw new SwapBelowLimitError(swapInfo, minAmount.toString(), 'from')
    }

    const maxAmount = await call('maxDepositAmount')
    if (gt(fantomAmount, maxAmount.toString())) {
      throw new SwapAboveLimitError(swapInfo, maxAmount.toString(), 'from')
    }

    const transaction: PopulatedTransaction = await new ethers.Contract(
      upgradeContractAddress,
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
          publicAddress: upgradeContractAddress
        }
      ],
      memos: [{ type: 'hex', value: transaction.data.replace(/^0x/, '') }],
      assetAction: {
        assetActionType: 'swap'
      },
      networkFeeOption: 'custom',
      customNetworkFee: {
        gasLimit: '60000' // Safe hardcoded value based on observation. Nodes cannot estimate gas for this transaction.
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
