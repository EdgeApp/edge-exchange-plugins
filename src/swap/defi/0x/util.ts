import { secp256k1 } from '@noble/curves/secp256k1'
import { div } from 'biggystring'
import { EdgeCurrencyWallet, EdgeTokenId } from 'edge-core-js/types'

import { NATIVE_ERC20_INTERFACES } from '../../../util/swapHelpers'
import { hexToDecimal } from '../../../util/utils'
import { NATIVE_TOKEN_ADDRESS } from './constants'
import { SignatureStruct, SignatureType } from './zeroXApiTypes'

/**
 * Retrieves the currency code for a given token ID on a given currency wallet.
 *
 * @param wallet The EdgeCurrencyWallet object.
 * @param tokenId The EdgeTokenId for the token.
 * @returns The currency code associated with the tokenId.
 * @throws Error if the token ID is not found in the wallet's currency configuration.
 */
export const getCurrencyCode = (
  wallet: EdgeCurrencyWallet,
  tokenId: EdgeTokenId
): string => {
  if (tokenId == null) {
    return wallet.currencyInfo.currencyCode
  } else {
    if (wallet.currencyConfig.allTokens[tokenId] == null) {
      throw new Error(
        `getCurrencyCode: tokenId: '${tokenId}' not found for wallet pluginId: '${wallet.currencyInfo.pluginId}'`
      )
    }
    return wallet.currencyConfig.allTokens[tokenId].currencyCode
  }
}

/**
 * Returns the token contract address for a given EdgeTokenId.
 *
 * @param wallet wallet object to look up token address
 * @param tokenId the EdgeTokenId of the token to look up
 * @returns the contract address of the token, or null for native token (e.g. ETH)
 */
export const getTokenAddress = (
  wallet: Pick<EdgeCurrencyWallet, 'currencyConfig'>,
  tokenId: EdgeTokenId
): string | null => {
  const edgeToken =
    tokenId == null ? undefined : wallet.currencyConfig.allTokens[tokenId]
  if (edgeToken == null) return null
  const address = edgeToken.networkLocation?.contractAddress
  if (address == null)
    throw new Error('Missing contractAddress in EdgeToken networkLocation')
  return address
}

/** One side of a swap, as 0x names and counts it. */
export interface ZeroXAsset {
  /** The token address 0x quotes, such as 0x3600…0000 for Arc's USDC */
  address: string
  /** Wallet native units per 0x unit: '1' unless 0x counts coarser */
  scale: string
}

/**
 * Resolves the asset 0x trades for one side of a request. A native asset is
 * the ERC-7528 address, except on chains listed in `NATIVE_ERC20_INTERFACES`.
 */
export const getZeroXAsset = (
  wallet: Pick<EdgeCurrencyWallet, 'currencyConfig' | 'currencyInfo'>,
  tokenId: EdgeTokenId
): ZeroXAsset => {
  const tokenAddress = getTokenAddress(wallet, tokenId)
  if (tokenAddress != null) return { address: tokenAddress, scale: '1' }

  const { denominations, pluginId } = wallet.currencyInfo
  const nativeInterface = NATIVE_ERC20_INTERFACES[pluginId]
  if (nativeInterface == null) {
    return { address: NATIVE_TOKEN_ADDRESS, scale: '1' }
  }
  return {
    address: nativeInterface.contractAddress,
    scale: div(denominations[0].multiplier, nativeInterface.multiplier)
  }
}

/**
 * Creates a signature struct from a signature hash. This signature struct
 * data type is used in the 0x Gasless Swap API when submitting the swap
 * transaction over the API tx-relay.
 *
 * @param signatureHash The signature hash.
 * @returns The signature struct.
 */
export function makeSignatureStruct(signatureHash: string): SignatureStruct {
  const signature = secp256k1.Signature.fromCompact(signatureHash.slice(2, 130))
  return {
    v: parseInt(hexToDecimal(`0x${signatureHash.slice(130)}`)),
    r: `0x${String(signature.r.toString(16))}`,
    s: `0x${String(signature.s.toString(16))}`,
    signatureType: SignatureType.EIP712
  }
}
