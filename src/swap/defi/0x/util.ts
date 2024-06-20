import { secp256k1 } from '@noble/curves/secp256k1'
import { EdgeCurrencyWallet, EdgeTokenId } from 'edge-core-js/types'

import { hexToDecimal } from '../../../util/utils'
import { SignatureStruct, SignatureType } from './apiTypes'

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
  wallet: EdgeCurrencyWallet,
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
    r: `0x${signature.r.toString(16)}`,
    s: `0x${signature.s.toString(16)}`,
    signatureType: SignatureType.EIP712
  }
}
