import { EdgeCurrencyWallet, EdgeTokenId } from 'edge-core-js/types'

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
