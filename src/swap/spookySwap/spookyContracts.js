// @flow
import { ethers } from 'ethers'

import UNISWAP_V2_ERC20_ABI from '../../abi/UNISWAP_V2_ERC20_ABI'
import UNISWAP_V2_PAIR_ABI from '../../abi/UNISWAP_V2_PAIR_ABI'
import UNISWAP_V2_ROUTER_ABI from '../../abi/UNISWAP_V2_ROUTER_ABI'
import WRAPPED_FTM_ABI from '../../abi/WRAPPED_FTM_ABI'

export { UNISWAP_V2_PAIR_ABI }

// Providers
//

export const hardCodedUrls = ['https://rpc.ftm.tools']

// TOOD: Use FallbackProvider when it's patched https://github.com/ethers-io/ethers.js/issues/2837
export const provider = new ethers.providers.JsonRpcProvider(hardCodedUrls[0])

//
// Contracts
//

const SPOOKYSWAP_ROUTER_ADDRESS = '0xF491e7B69E4244ad4002BC14e878a34207E38c29'
export const spookySwapRouter = new ethers.Contract(
  SPOOKYSWAP_ROUTER_ADDRESS,
  UNISWAP_V2_ROUTER_ABI,
  provider
)

const WFTM_TOKEN_ADDRESS = '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
export const wrappedFtmToken = new ethers.Contract(
  WFTM_TOKEN_ADDRESS,
  WRAPPED_FTM_ABI,
  provider
)

export const makeErc20Contract = (tokenAddress: string) =>
  new ethers.Contract(tokenAddress, UNISWAP_V2_ERC20_ABI, provider)
