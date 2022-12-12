import { Contract, ethers } from 'ethers'

import UNISWAP_V2_ERC20_ABI from '../abi/UNISWAP_V2_ERC20_ABI'
import UNISWAP_V2_ROUTER_ABI from '../abi/UNISWAP_V2_ROUTER_ABI'
import WRAPPED_FTM_ABI from '../abi/WRAPPED_FTM_ABI'

//
// Providers
//

// TOOD: Use FallbackProvider when it's patched https://github.com/ethers-io/ethers.js/issues/2837
export const FTM_FALLBACK_PROVIDER_URL = 'https://rpc.ftm.tools'
export const FTM_BASE_QUIKNODE_URL =
  'https://polished-empty-cloud.fantom.quiknode.pro/'

export const POLYGON_PROVIDER_URL = 'https://polygon-rpc.com'

export const getEvmProvider = (
  swapPluginId: string,
  quiknodeApiKey?: string
): ethers.providers.Provider => {
  switch (swapPluginId) {
    case 'tombSwap':
    case 'spookySwap':
      return new ethers.providers.JsonRpcProvider(
        quiknodeApiKey != null && quiknodeApiKey !== ''
          ? `${FTM_BASE_QUIKNODE_URL}${quiknodeApiKey}`
          : FTM_FALLBACK_PROVIDER_URL
      )
    case 'quickSwap':
      return new ethers.providers.JsonRpcProvider(POLYGON_PROVIDER_URL)
    default:
      throw new Error(
        `getEvmProvider: Unsupported swapPluginId: ${swapPluginId}`
      )
  }
}

//
// Contracts
//

// Routers
const SPOOKYSWAP_ROUTER_ADDRESS = '0xF491e7B69E4244ad4002BC14e878a34207E38c29'
export const makeSpookySwapRouterContract = (
  provider: ethers.providers.Provider
): Contract =>
  new ethers.Contract(
    SPOOKYSWAP_ROUTER_ADDRESS,
    UNISWAP_V2_ROUTER_ABI,
    provider
  )

const TOMBSWAP_ROUTER_ADDRESS = '0x6D0176C5ea1e44b08D3dd001b0784cE42F47a3A7'
export const makeTombSwapRouterContract = (
  provider: ethers.providers.Provider
): Contract =>
  new ethers.Contract(TOMBSWAP_ROUTER_ADDRESS, UNISWAP_V2_ROUTER_ABI, provider)

const QUICKSWAP_ROUTER_ADDRESS = '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff'
export const makeQuickswapRouterContract = (
  provider: ethers.providers.Provider
): Contract =>
  new ethers.Contract(QUICKSWAP_ROUTER_ADDRESS, UNISWAP_V2_ROUTER_ABI, provider)

// Wrapped Tokens
export const WFTM_TOKEN_ADDRESS = '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
export const WMATIC_TOKEN_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'
export const makeWethContract = (
  provider: ethers.providers.Provider,
  wethAddress: string
): Contract => new ethers.Contract(wethAddress, WRAPPED_FTM_ABI, provider)

export const makeErc20Contract = (
  provider: ethers.providers.Provider,
  tokenAddress: string
): Contract => new ethers.Contract(tokenAddress, UNISWAP_V2_ERC20_ABI, provider)
