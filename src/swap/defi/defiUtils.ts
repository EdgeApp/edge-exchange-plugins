import { asMaybe, asObject, asString } from 'cleaners'
import {
  EdgeCurrencyConfig,
  EdgeSpendInfo,
  EdgeToken,
  EdgeTransaction
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import { EdgeSwapRequestPlugin } from '../types'
import abi from './abi/THORCHAIN_SWAP_ABI'
import erc20Abi from './abi/UNISWAP_V2_ERC20_ABI'

export interface InOutTokenAddresses {
  fromTokenAddress: string
  toTokenAddress: string
  isWrappingSwap: boolean
  isFromNativeCurrency: boolean
  isToNativeCurrency: boolean
  isFromWrappedCurrency: boolean
  isToWrappedCurrency: boolean
}

const asContractLocation = asObject({
  contractAddress: asString
})

/**
 * Determine if the tokens are wrapped and return the appropriate wrapped
 * contract addresses, if different.
 */
export const getInOutTokenAddresses = (
  currencyConfig: EdgeCurrencyConfig,
  wrappedMainnetAddress: string,
  fromTokenId: string | null,
  toTokenId: string | null
): InOutTokenAddresses => {
  const { allTokens } = currencyConfig

  const isFromNativeCurrency = fromTokenId == null
  const isToNativeCurrency = toTokenId == null

  const fromToken: EdgeToken | undefined = isFromNativeCurrency
    ? undefined
    : allTokens[fromTokenId]
  const toToken: EdgeToken | undefined = isToNativeCurrency
    ? undefined
    : allTokens[toTokenId]

  const fromTokenAddress = isFromNativeCurrency
    ? wrappedMainnetAddress
    : asMaybe(asContractLocation)(fromToken?.networkLocation)
        ?.contractAddress ?? ''
  const toTokenAddress = isToNativeCurrency
    ? wrappedMainnetAddress
    : asMaybe(asContractLocation)(toToken?.networkLocation)?.contractAddress ??
      ''

  const isFromWrappedCurrency =
    fromTokenAddress.toLowerCase() === wrappedMainnetAddress.toLowerCase()
  const isToWrappedCurrency =
    toTokenAddress.toLowerCase() === wrappedMainnetAddress.toLowerCase()

  const isWrappingSwap =
    (isFromNativeCurrency && isToWrappedCurrency) ||
    (isFromWrappedCurrency && isToNativeCurrency)

  return {
    fromTokenAddress,
    toTokenAddress,
    isWrappingSwap,
    isFromNativeCurrency,
    isToNativeCurrency,
    isFromWrappedCurrency,
    isToWrappedCurrency
  }
}

const getEvmCheckSumAddress = (assetAddress: string): string => {
  // if (assetAddress === ETHAddress) return ETHAddress
  return ethers.utils.getAddress(assetAddress.toLowerCase())
}

export const getEvmApprovalData = ({
  contractAddress,
  nativeAmount
}: {
  contractAddress: string
  nativeAmount: string
}): string => {
  const iface = new ethers.utils.Interface(erc20Abi)
  const data = iface.encodeFunctionData('approve', [
    contractAddress,
    nativeAmount
  ])
  return data
}

const NON_STANDARD_APPROVAL_TOKENS: { [pluginId: string]: string[] } = {
  ethereum: ['dac17f958d2ee523a2206206994597c13d831ec7' /* USDT */]
}

export const createEvmApprovalEdgeTransactions = async ({
  request,
  approvalAmount,
  tokenContractAddress,
  recipientAddress,
  networkFeeOption,
  customNetworkFee
}: {
  request: EdgeSwapRequestPlugin
  approvalAmount: string
  tokenContractAddress: string
  recipientAddress: string
  networkFeeOption?: EdgeSpendInfo['networkFeeOption']
  customNetworkFee?: EdgeSpendInfo['customNetworkFee']
}): Promise<EdgeTransaction[]> => {
  const out: EdgeTransaction[] = []

  const createApprovalTx = async (amount: string): Promise<EdgeTransaction> => {
    const approvalData = getEvmApprovalData({
      contractAddress: recipientAddress,
      nativeAmount: amount
    })
    const spendInfo: EdgeSpendInfo = {
      tokenId: null,
      memos: [{ type: 'hex', value: approvalData.replace(/^0x/, '') }],
      spendTargets: [
        {
          nativeAmount: '0',
          publicAddress: tokenContractAddress
        }
      ],
      pendingTxs: [...out],
      networkFeeOption,
      customNetworkFee,
      assetAction: {
        assetActionType: 'tokenApproval'
      },
      savedAction: {
        actionType: 'tokenApproval',
        tokenApproved: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: amount
        },
        tokenContractAddress: tokenContractAddress,
        contractAddress: recipientAddress
      }
    }
    return await request.fromWallet.makeSpend(spendInfo)
  }

  // If the token requires resetting allowance to 0, create a pre-tx to do so
  if (
    request.fromTokenId != null &&
    NON_STANDARD_APPROVAL_TOKENS[
      request.fromWallet.currencyInfo.pluginId
    ]?.includes(request.fromTokenId)
  ) {
    const preTx = await createApprovalTx('0')
    out.push(preTx)
  }

  const preTx = await createApprovalTx(approvalAmount)
  out.push(preTx)

  return out
}

export const getDepositWithExpiryData = async (params: {
  memo: string
  // usersSendingAddress: string,
  assetAddress: string
  contractAddress: string
  vaultAddress: string
  amountToSwapWei: number
}): Promise<string> => {
  // const isETH = assetAddress === ETHAddress
  const {
    // usersSendingAddress,
    assetAddress,
    contractAddress,
    memo,
    vaultAddress,
    amountToSwapWei
  } = params

  // initialize contract
  const contract = new ethers.Contract(
    contractAddress,
    abi,
    ethers.providers.getDefaultProvider()
  )

  // Dummy gasPrice that we won't actually use
  const gasPrice = ethers.BigNumber.from('50')

  // Calculate expiry timestamp (current time + 60 minutes in seconds)
  const currentTimeSeconds = Math.floor(Date.now() / 1000)
  const expiryTimeSeconds = currentTimeSeconds + 60 * 60 // 60 minutes in seconds

  // setup contract params
  const contractParams: any[] = [
    vaultAddress,
    getEvmCheckSumAddress(assetAddress),
    amountToSwapWei.toFixed(),
    memo,
    expiryTimeSeconds,
    { gasPrice }
  ]

  // call the depositWithExpiry method on the thorchain router.
  const tx = await contract.populateTransaction.depositWithExpiry(
    ...contractParams
  )
  if (tx.data == null) throw new Error('No data in tx object')
  return tx.data
}

export const WEI_MULTIPLIER = '1000000000'
