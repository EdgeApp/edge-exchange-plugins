export const EXPIRATION_MS = 1000 * 60
/** [The ERC-7528: ETH (Native Asset) Address Convention](https://eips.ethereum.org/EIPS/eip-7528) */
export const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Chains whose native asset 0x trades through an ERC-20 interface to the
 * native balance, at the interface's precision. Arc's native asset is USDC,
 * which the wallet counts in 18 decimals. 0x rejects the native token address
 * on Arc and trades the same balance as the token at 0x3600…0000 in 6.
 */
export const NATIVE_ERC20_INTERFACES: {
  [pluginId: string]: { contractAddress: string; multiplier: string }
} = {
  arc: {
    contractAddress: '0x3600000000000000000000000000000000000000',
    multiplier: '1000000'
  }
}
