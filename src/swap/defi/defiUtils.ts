import { asMaybe, asObject, asString } from 'cleaners'
import { EdgeCurrencyConfig, EdgeToken } from 'edge-core-js/types'
import { ethers } from 'ethers'

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

export const getEvmApprovalData = async (params: {
  contractAddress: string
  assetAddress: string
  nativeAmount: string
}): Promise<string | undefined> => {
  const { contractAddress, assetAddress, nativeAmount } = params
  const contract = new ethers.Contract(
    assetAddress,
    erc20Abi,
    ethers.providers.getDefaultProvider()
  )

  const bnNativeAmount = ethers.BigNumber.from(nativeAmount)
  const approveTx = await contract.populateTransaction.approve(
    contractAddress,
    bnNativeAmount,
    {
      gasLimit: '500000',
      gasPrice: '20'
    }
  )
  return approveTx.data != null ? approveTx.data.replace(/^0x/, '') : undefined
}

export const getEvmTokenData = async (params: {
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

  // setup contract params
  const contractParams: any[] = [
    vaultAddress,
    getEvmCheckSumAddress(assetAddress),
    amountToSwapWei.toFixed(),
    memo,
    { gasPrice }
  ]

  // call the deposit method on the thorchain router.
  const tx = await contract.populateTransaction.deposit(...contractParams)
  if (tx.data == null) throw new Error('No data in tx object')
  return tx.data
}
