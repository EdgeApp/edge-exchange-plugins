import contracts from '@unizen-io/unizen-contract-addresses/production.json'
import { div } from 'biggystring'
import {
  asArray,
  asMaybe,
  asNumber,
  asObject,
  asString,
  asTuple,
  asValue
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeLog,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  JsonObject,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress } from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'
import { getTokenAddress } from './0x/util'
import { getEvmApprovalData, WEI_MULTIPLIER } from './defiUtils'

const pluginId = 'unizen'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: true,
  displayName: 'Unizen',
  supportEmail: 'support@edge.app'
}

const asInitOptions = asObject({
  apiKey: asString
})

const BASE_URL = 'https://api.zcx.com'
const PARENT_ADDRESS = '0x0000000000000000000000000000000000000000'

type SwapNetworkFees = Pick<
  EdgeSpendInfo,
  'customNetworkFee' | 'networkFeeOption'
>

interface QuoteSpendParams extends SwapNetworkFees {
  destinationAddress: string
  expirationDate: Date
  memos: EdgeMemo[]
  minReceiveAmount: string
  metadataNotes: string
}

const makeEvmFees = (rate: string, units: string = 'wei'): SwapNetworkFees => {
  const multiplier = units === 'wei' ? WEI_MULTIPLIER : 1
  return {
    customNetworkFee: {
      gasPrice: div(rate, multiplier)
    },
    networkFeeOption: 'custom'
  }
}
const makeUtxoFees = (rate: string): SwapNetworkFees => {
  return {
    customNetworkFee: {
      satPerByte: rate
    },
    networkFeeOption: 'custom'
  }
}
const makeCosmosFees = (): SwapNetworkFees => {
  return {
    networkFeeOption: 'standard'
  }
}

// https://api.zcx.com/trade/v1/info/chains
// https://docs.unizen.io/api-get-started/utxo-assets-and-cosmos-swap/get-trade-v1-chainid-quote-cross-1
export const PLUGIN_ID_UNIZEN_MAP: {
  [pluginId: string]: {
    unizenId: number
    unizenName: string
    makeFee: (rate: string, units?: string) => SwapNetworkFees
  }
} = {
  // EVM
  arbitrum: { unizenId: 42161, unizenName: 'arbitrum', makeFee: makeEvmFees },
  avalanche: { unizenId: 43114, unizenName: 'avax', makeFee: makeEvmFees },
  base: { unizenId: 8453, unizenName: 'base', makeFee: makeEvmFees },
  binancesmartchain: { unizenId: 56, unizenName: 'bsc', makeFee: makeEvmFees },
  ethereum: { unizenId: 1, unizenName: 'ethereum', makeFee: makeEvmFees },
  fantom: { unizenId: 250, unizenName: 'fantom', makeFee: makeEvmFees },
  optimism: { unizenId: 10, unizenName: 'optimism', makeFee: makeEvmFees },
  polygon: { unizenId: 137, unizenName: 'polygon', makeFee: makeEvmFees },

  // Cosmos
  cosmoshub: { unizenId: -978111860, unizenName: '', makeFee: makeCosmosFees },

  // UTXO
  bitcoin: { unizenId: -3980891822, unizenName: '', makeFee: makeUtxoFees },
  bitcoincash: { unizenId: -174457306, unizenName: '', makeFee: makeUtxoFees },
  litecoin: { unizenId: -33463083, unizenName: '', makeFee: makeUtxoFees },
  dogecoin: { unizenId: -3143381382, unizenName: '', makeFee: makeUtxoFees }
}

const UNIZEN_CONTRACTS: {
  [version: string]: StringMap
} = contracts
const createQuotePath = (
  fromChainId: number,
  fromToken: string,
  toChainId: number,
  toToken: string,
  amount: string,
  sender: string,
  receiver: string
): string => {
  if (fromChainId === toChainId) {
    return `/trade/v1/${fromChainId}/quote/single?fromTokenAddress=${fromToken}&toTokenAddress=${toToken}&amount=${amount}&sender=${sender}&receiver=${receiver}&disableEstimate=false`
  } else {
    return `/trade/v1/${fromChainId}/quote/cross?fromTokenAddress=${fromToken}&destinationChainId=${toChainId}&toTokenAddress=${toToken}&amount=${amount}&sender=${sender}&receiver=${receiver}&disableEstimate=true`
  }
}

export function makeUnizenPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { apiKey } = asInitOptions(opts.initOptions)
  if (apiKey === '') throw new Error('Missing Unizen API key')

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet } = request
    const fromChainId =
      PLUGIN_ID_UNIZEN_MAP[request.fromWallet.currencyInfo.pluginId]?.unizenId
    const toChainId =
      PLUGIN_ID_UNIZEN_MAP[request.toWallet.currencyInfo.pluginId]?.unizenId
    if (fromChainId == null || toChainId == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromContractAddress =
      getTokenAddress(request.fromWallet, request.fromTokenId) ?? PARENT_ADDRESS
    const toContractAddress =
      getTokenAddress(request.toWallet, request.toTokenId) ?? PARENT_ADDRESS

    const fromWalletAddress = await getAddress(fromWallet)
    const toWalletAddress = await getAddress(toWallet)

    const quotePath = createQuotePath(
      fromChainId,
      fromContractAddress,
      toChainId,
      toContractAddress,
      request.nativeAmount,
      fromWalletAddress,
      toWalletAddress
    )
    log('unizen quote path', quotePath)

    const res = await io.fetchCors(BASE_URL + quotePath, {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': `Bearer ${apiKey}`
      }
    })
    const quote = await res.json()
    if (!res.ok) {
      const error = asMaybe(
        asObject({
          message: asString
        })
      )(quote)
      switch (error?.message) {
        case 'Insufficient amount': // not enough info provided on minimum amount
        case 'No cross chain provider available for this trade':
          throw new SwapCurrencyError(swapInfo, request)
        default: {
          throw new Error(
            `Error fetching Unizen quote ${error?.message ?? 'Unknown error'}`
          )
        }
      }
    }

    log('unizen quote', JSON.stringify(quote))

    const spendParams = makeSpendParams(request, log, fromChainId, quote)
    log('unizen spend params', spendParams)

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: request.nativeAmount,
          publicAddress: spendParams.destinationAddress
        }
      ],
      memos: spendParams.memos,
      networkFeeOption: spendParams.networkFeeOption,
      customNetworkFee: spendParams.customNetworkFee,
      assetAction: {
        assetActionType: 'swap'
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        isEstimate: true,
        toAsset: {
          pluginId: toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: spendParams.minReceiveAmount
        },
        fromAsset: {
          pluginId: fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: request.nativeAmount
        },
        payoutAddress: toWalletAddress,
        payoutWalletId: toWallet.id,
        refundAddress: fromWalletAddress
      }
    }

    log('unizen spendInfo', JSON.stringify(spendInfo))

    // create approval transaction, if needed
    let preTx: EdgeTransaction | undefined
    const approvalNeeded = asMaybe(asInsufficientAllowance)(quote)
    if (approvalNeeded != null) {
      const approvalData = await getEvmApprovalData({
        contractAddress: spendParams.destinationAddress,
        assetAddress: fromContractAddress,
        nativeAmount: request.nativeAmount
      })
      if (approvalData == null)
        throw new Error('Failed to create approval data')

      const spendInfo: EdgeSpendInfo = {
        tokenId: null,
        memos: [{ type: 'hex', value: approvalData }],
        spendTargets: [
          {
            nativeAmount: '0',
            publicAddress: fromContractAddress
          }
        ],
        networkFeeOption: spendParams.networkFeeOption,
        customNetworkFee: spendParams.customNetworkFee,
        assetAction: {
          assetActionType: 'tokenApproval'
        },
        savedAction: {
          actionType: 'tokenApproval',
          tokenApproved: {
            pluginId: request.fromWallet.currencyInfo.pluginId,
            tokenId: request.fromTokenId,
            nativeAmount: request.nativeAmount
          },
          tokenContractAddress: fromContractAddress,
          contractAddress: spendParams.destinationAddress
        }
      }
      preTx = await request.fromWallet.makeSpend(spendInfo)
    }

    log('unizen preTx', JSON.stringify(preTx ?? {}))

    const out: SwapOrder = {
      expirationDate: spendParams.expirationDate,
      fromNativeAmount: request.nativeAmount,
      metadataNotes: spendParams.metadataNotes,
      minReceiveAmount: spendParams.minReceiveAmount,
      preTx,
      request,
      spendInfo,
      swapInfo
    }
    return out
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      let newRequest = request
      if (request.quoteFor === 'max') {
        if (request.fromTokenId != null) {
          const maxAmount =
            request.fromWallet.balanceMap.get(request.fromTokenId) ?? '0'
          newRequest = { ...request, nativeAmount: maxAmount, quoteFor: 'from' }
        } else {
          newRequest = await getMaxSwappable(
            async r => await fetchSwapQuoteInner(r),
            request
          )
        }
      }
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}

export const makeSpendParams = (
  request: EdgeSwapRequestPlugin,
  log: EdgeLog,
  fromChainId: number,
  rawQuote: JsonObject
): QuoteSpendParams => {
  const { unizenName, makeFee } = PLUGIN_ID_UNIZEN_MAP[
    request.fromWallet.currencyInfo.pluginId
  ]

  const evmSingleChain = asMaybe(asEvmSingleChainSwapQuotes)(rawQuote)
  if (evmSingleChain != null) {
    const contractAddress: string | undefined =
      UNIZEN_CONTRACTS[evmSingleChain[0].contractVersion]?.[unizenName]

    if (contractAddress == null) {
      log.warn(
        'Contract address not found, try updating @unizen-io/unizen-contract-addresses ' +
          evmSingleChain[0].contractVersion
      )
      throw new SwapCurrencyError(swapInfo, request)
    }

    return {
      ...makeFee(evmSingleChain[0].gasPrice),
      destinationAddress: contractAddress,
      expirationDate: new Date(
        evmSingleChain[0].transactionData.info.deadline * 1000
      ),
      memos: [
        {
          type: 'hex',
          value: memoToHex(evmSingleChain[0].data)
        }
      ],
      metadataNotes: `DEX Provider: ${evmSingleChain[0].protocol
        .map(p => p.name)
        .join(', ')}`,
      minReceiveAmount: evmSingleChain[0].transactionData.info.amountOutMin
    }
  }

  const crossChain = asMaybe(asCrossChainSwapQuotes)(rawQuote)
  if (crossChain != null) {
    const memos: EdgeMemo[] = []
    const memoValue = crossChain[0].transactionData.memo
    if (fromChainId > 0) {
      memos.push({
        type: 'hex',
        value: memoToHex(memoValue)
      })
    } else {
      memos.push({
        type: 'text',
        value: memoValue
      })
    }

    return {
      ...makeFee(
        crossChain[0].transactionData.recommended_gas_rate,
        crossChain[0].transactionData.gas_rate_units
      ),
      destinationAddress: crossChain[0].transactionData.inbound_address,
      expirationDate: new Date(crossChain[0].transactionData.expiry * 1000),
      memos,
      metadataNotes: `DEX Provider: ${crossChain[0].providerInfo.name}`,
      minReceiveAmount: crossChain[0].transactionData.expected_amount_out
    }
  }

  throw new SwapCurrencyError(swapInfo, request)
}

const asInsufficientAllowance = asObject({
  insufficientAllowance: asValue(true)
})

const asEvmSingleChainSwapQuotes = asTuple(
  asObject({
    protocol: asArray(
      asObject({
        name: asString
      })
    ),
    transactionData: asObject({
      info: asObject({
        deadline: asNumber,
        amountOutMin: asString
      })
    }),
    contractVersion: asString,
    gasPrice: asString,
    data: asString
  })
)

const asCrossChainSwapQuotes = asTuple(
  asObject({
    transactionData: asObject({
      inbound_address: asString,
      expiry: asNumber,
      memo: asString,
      recommended_gas_rate: asString,
      gas_rate_units: asString,
      expected_amount_out: asString
    }),
    providerInfo: asObject({
      name: asString
    })
  })
)

const memoToHex = (memo: string): string =>
  memo.toLowerCase().startsWith('0x')
    ? `${memo.slice(2).toUpperCase()}` // 0xhex to hex
    : Buffer.from(memo).toString('hex') // ascii to hex
