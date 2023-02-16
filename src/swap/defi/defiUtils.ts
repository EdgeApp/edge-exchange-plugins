import { EdgeCurrencyInfo, EdgeMetaToken } from 'edge-core-js/types'
import { ethers } from 'ethers'

import abi from './abi/THORCHAIN_SWAP_ABI'
import erc20Abi from './abi/UNISWAP_V2_ERC20_ABI'

/**
 * Get the token contract addresses from the wallet's EdgeMetaTokens
 */
export const getMetaTokenAddress = (
  metaTokens: EdgeMetaToken[],
  tokenCurrencyCode: string
): string => {
  const metaToken = metaTokens.find(mt => mt.currencyCode === tokenCurrencyCode)

  if (metaToken == null || metaToken?.contractAddress === undefined)
    throw new Error('Could not find contract address for ' + tokenCurrencyCode)

  return metaToken.contractAddress ?? ''
}

/**
 * Determine if the tokens are wrapped and return the appropriate wrapped
 * contract addresses, if different.
 */
export const getInOutTokenAddresses = (
  currencyInfo: EdgeCurrencyInfo,
  fromCurrencyCode: string,
  toCurrencyCode: string
): {
  fromTokenAddress: string
  toTokenAddress: string
  isWrappingSwap: boolean
} => {
  const { currencyCode: nativeCurrencyCode, metaTokens } = currencyInfo
  const wrappedCurrencyCode = `W${nativeCurrencyCode}`
  const isFromNativeCurrency = fromCurrencyCode === nativeCurrencyCode
  const isToNativeCurrency = toCurrencyCode === nativeCurrencyCode
  const isFromWrappedCurrency = fromCurrencyCode === wrappedCurrencyCode
  const isToWrappedCurrency = toCurrencyCode === wrappedCurrencyCode
  const isWrappingSwap =
    (isFromNativeCurrency && isToWrappedCurrency) ||
    (isFromWrappedCurrency && isToNativeCurrency)

  const fromTokenAddress = getMetaTokenAddress(
    metaTokens,
    isFromNativeCurrency ? wrappedCurrencyCode : fromCurrencyCode
  )
  const toTokenAddress = getMetaTokenAddress(
    metaTokens,
    isToNativeCurrency ? wrappedCurrencyCode : toCurrencyCode
  )

  return { fromTokenAddress, toTokenAddress, isWrappingSwap }
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
  return approveTx.data
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
