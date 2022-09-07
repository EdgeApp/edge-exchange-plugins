
import { JsonRpcProvider } from '@ethersproject/providers'
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

export const getFtmProvider: JsonRpcProvider = (quiknodeApiKey?: string) =>
  new ethers.providers.JsonRpcProvider(
    quiknodeApiKey != null && quiknodeApiKey !== ''
      ? `${FTM_BASE_QUIKNODE_URL}${quiknodeApiKey}`
      : FTM_FALLBACK_PROVIDER_URL
  )

//
// Contracts
//

// Routers
const SPOOKYSWAP_ROUTER_ADDRESS = '0xF491e7B69E4244ad4002BC14e878a34207E38c29'
export const makeSpookySwapRouterContract: Contract = (
  provider: JsonRpcProvider
) =>
  new ethers.Contract(
    SPOOKYSWAP_ROUTER_ADDRESS,
    UNISWAP_V2_ROUTER_ABI,
    provider
  )

const TOMBSWAP_ROUTER_ADDRESS = '0x6D0176C5ea1e44b08D3dd001b0784cE42F47a3A7'
export const makeTombSwapRouterContract: Contract = (
  provider: JsonRpcProvider
) =>
  new ethers.Contract(TOMBSWAP_ROUTER_ADDRESS, UNISWAP_V2_ROUTER_ABI, provider)

// Wrapped Tokens
const WFTM_TOKEN_ADDRESS = '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
export const makeWrappedFtmContract: Contract = (provider: JsonRpcProvider) =>
  new ethers.Contract(WFTM_TOKEN_ADDRESS, WRAPPED_FTM_ABI, provider)

export const makeErc20Contract = (
  provider: JsonRpcProvider,
  tokenAddress: string
) => new ethers.Contract(tokenAddress, UNISWAP_V2_ERC20_ABI, provider)
