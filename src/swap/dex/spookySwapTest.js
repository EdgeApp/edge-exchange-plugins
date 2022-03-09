// @flow

import { ethers } from 'ethers'
import readlineSync from 'readline-sync'
import Web3 from 'web3'

import { FANTOM_MAINNET_RPC } from './constants.js'
import {
  BOO_ADDRESS,
  BOO_CONTRACT_ABI,
  SPOOKYSWAP_DEPOSIT_CONTRACT_ABI,
  SPOOKYSWAP_DEPOSIT_CONTRACT_ADDRESS,
  SPOOKYSWAP_FACTORY_ABI,
  SPOOKYSWAP_FACTORY_ADDRESS,
  SPOOKYSWAP_ROUTER_ABI,
  SPOOKYSWAP_ROUTER_ADDRESS,
  SPOOKYSWAP_WITHDRAW_CONTRACT_ABI,
  SPOOKYSWAP_WITHDRAW_CONTRACT_ADDRESS,
  TOMB_ADDRESS,
  uniswapV2PairABI,
  WFTM_ADDRESS,
  wFTM_BOO_MASTER_CONTRACT_ABI,
  wFTM_BOO_MASTERCHEF_CONTRACT,
  wFTMABI,
  wFTMBOOspLPAddress
} from './contracts.js'
import { convertToHex } from './functionCalls.js'

const rpcProviderUrls = [
  'https://rpcapi.fantom.network',
  'https://rpc.fantom.network',
  'https://rpc2.fantom.network',
  'https://rpc3.fantom.network',
  'https://rpc.ftm.tools'
]

const providers = []
for (const address of rpcProviderUrls) {
  const provider = new ethers.providers.JsonRpcProvider(address)
  providers.push(provider)
}
const customHttpProvider = new ethers.providers.JsonRpcProvider(
  'https://rpc.ftm.tools'
) // new ethers.providers.FallbackProvider(providers, 1);
// const dummyProvider = new Web3(new Web3.providers.HttpProvider("https://www.google.com"));

const key = '1f25216e2b05a01857eeb4936bca1e615da301c0932927b71f5e29e6ec1e1cb9'
const toAddress = '0x749411cf4DA88194581921Ae55f6fc4357D3b0f2'

const account = new ethers.Wallet(key, customHttpProvider)
const booContract = new ethers.Contract(
  BOO_ADDRESS,
  BOO_CONTRACT_ABI,
  customHttpProvider
)
const tombContract = new ethers.Contract(
  TOMB_ADDRESS,
  BOO_CONTRACT_ABI,
  account
)
const wFTMContract = new ethers.Contract(
  WFTM_ADDRESS,
  wFTMABI,
  customHttpProvider
)
const wFTMBOOspLPContract = new ethers.Contract(
  wFTMBOOspLPAddress,
  uniswapV2PairABI,
  customHttpProvider
)
const wFTMBooContract = new ethers.Contract(
  wFTM_BOO_MASTERCHEF_CONTRACT,
  wFTM_BOO_MASTER_CONTRACT_ABI,
  account
)
const spookyRouter = new ethers.Contract(
  SPOOKYSWAP_ROUTER_ADDRESS,
  SPOOKYSWAP_ROUTER_ABI,
  account
)
const cachedPairDatas = [
  {
    tokenAddresses: [WFTM_ADDRESS, BOO_ADDRESS],
    lpAddress: '0xec7178f4c41f346b2721907f5cf7628e388a7a58'
  },
  {
    tokenAddresses: [BOO_ADDRESS, TOMB_ADDRESS],
    lpAddress: '0xe193De3E2ADE715A87A339AB7a1825fBc468aEF8'
  },
  {
    tokenAddresses: [WFTM_ADDRESS, TOMB_ADDRESS],
    lpAddress: '0x2A651563C9d3Af67aE0388a5c8F89b867038089e'
  }
]

// TODO: remove
export const getRouterMethodName = (
  isFromNativeCurrency,
  isToNativeCurrency
) => {
  if (isFromNativeCurrency && isToNativeCurrency)
    throw new Error('Invalid swap: Cannot swap to the same native currency')

  let retVal
  if (isFromNativeCurrency)
    retVal = {
      routerMethodName: 'swapExactETHForTokens',
      isAmountInParam: false
    }
  else if (isToNativeCurrency)
    retVal = {
      routerMethodName: 'swapExactTokensForETH',
      isAmountInParam: true
    }
  else
    retVal = {
      routerMethodName: 'swapExactTokensForTokens',
      isAmountInParam: true
    }

  console.log(
    '\x1b[30m\x1b[42m' +
      `methodName: ${JSON.stringify(retVal, null, 2)}` +
      '\x1b[0m'
  )
  return retVal
}

/**
 * TODO: Break each case into a named fn swapExactETHForTokens(),
 * swapExactTokensForETH(), swapExactTokensForTokens(), etc.
 *
 */

export const getRouterTransaction = async (
  router,
  isFromNativeCurrency,
  isToNativeCurrency,
  swapInputAmount,
  swapOutputAmount,
  path,
  receiveAddress,
  deadline
) => {
  const { routerMethodName, isAmountInParam } = getRouterMethodName(
    isFromNativeCurrency,
    isToNativeCurrency
  )

  if (isAmountInParam)
    return await router[routerMethodName](
      swapInputAmount.toHexString(),
      swapOutputAmount.toHexString(),
      path,
      receiveAddress,
      deadline,
      {
        gasLimit: ethers.utils.hexlify(340722),
        gasPrice: ethers.utils.parseUnits('350', 'gwei')
      }
    )
  else {
    return await router[routerMethodName](
      swapOutputAmount.toHexString(),
      // '0x00',
      path,
      receiveAddress,
      deadline,
      {
        gasLimit: ethers.utils.hexlify(340722),
        gasPrice: ethers.utils.parseUnits('350', 'gwei'),
        value: swapInputAmount.toHexString()
      }
    )
  }
}

export async function getRateAndPath(
  fromTokenAddress: string,
  toTokenAddress: string,
  lpContract: ethers.Contract
): Promise<{ exchangeRate: number, path: string[] }> {
  const exchangeRate = await lpContract
    .getReserves()
    .then(reserves => Number(reserves._reserve0) / Number(reserves._reserve1))

  // Check if the token being swapped is the 0 or 1 token index and invert the
  // rate if needed.
  // token1's address as a value literal is always less than token1's address
  // value
  const isFromToken0 =
    convertToDecimal(fromTokenAddress) > convertToDecimal(toTokenAddress)

  return {
    exchangeRate: isFromToken0 ? exchangeRate : 1 / exchangeRate,
    path: ['0x749411cf4DA88194581921Ae55f6fc4357D3b0f2', toTokenAddress]
    // path: isFromToken0
    //   ? [fromTokenAddress, toTokenAddress]
    //   : [toTokenAddress, fromTokenAddress]
  }
}

async function getLpContract(
  tokenAddress0,
  tokenAddress1,
  pairDatas,
  provider
) {
  const foundPairData = pairDatas.find(pairData =>
    pairData.tokenAddresses.every(pairTokenAddress => {
      return (
        tokenAddress0.toUpperCase() === pairTokenAddress.toUpperCase() ||
        tokenAddress1.toUpperCase() === pairTokenAddress.toUpperCase()
      )
    })
  )
  const lpAddress = foundPairData?.lpAddress

  if (lpAddress == null)
    throw new Error(
      `Could not find LP contract for tokens: ${tokenAddress0} ${tokenAddress1}`
    )

  return new ethers.Contract(lpAddress, uniswapV2PairABI, provider)
}

/** TODO: Split into:
 * 1. getSwapDetails() -
 */
async function testSwap() {
  // TODO: getSwapDetails() START
  const swapInputAmount = ethers.utils.parseEther('0.01', 'ether')
  console.log(
    '\x1b[34m\x1b[43m' +
      `Swap Input Amount: ${ethers.utils
        .formatEther(swapInputAmount)
        .toString()} (${swapInputAmount})` +
      '\x1b[0m'
  )

  const path = [WFTM_ADDRESS, BOO_ADDRESS] // ETH for Tokens
  // const path = [BOO_ADDRESS, WFTM_ADDRESS] // Tokens for Eth

  const swapOutputAmount = await spookyRouter
    .getAmountsOut(swapInputAmount, path)
    .then(getAmountsOutRes => {
      // console.log('\x1b[30m\x1b[42m' + `Router getAmountsOut: ${JSON.stringify(getAmountsOutRes, null, 2)}` + '\x1b[0m')
      // console.log('\x1b[30m\x1b[42m' + `[0]:
      // ${ethers.utils.formatEther(getAmountsOutRes[0]).toString()}, [1]:
      // ${ethers.utils.formatEther(getAmountsOutRes[1]).toString()}` +
      // '\x1b[0m')
      // return getAmountsOutRes[1].sub(getAmountsOutRes[1].div(99))

      const [inputBN, outputBN] = getAmountsOutRes
      console.log(
        '\x1b[34m\x1b[43m' +
          `{inputBN, outputBN}: ${JSON.stringify(
            { inputBN, outputBN },
            null,
            2
          )}` +
          '\x1b[0m'
      )
      return outputBN.sub(outputBN.div(99))
    })
  // getSwapDetails() END

  console.log(
    '\x1b[30m\x1b[42m' +
      `Swap output amount: ${JSON.stringify(
        ethers.utils.formatEther(swapOutputAmount).toString(),
        null,
        2
      )}` +
      '\x1b[0m'
  )

  // TODO: generateSignedTx() START
  const tx = await getRouterTransaction(
    spookyRouter,
    true,
    false,
    swapInputAmount,
    swapOutputAmount,
    path,
    toAddress,
    (Math.floor(Date.now() / 1000) + 60 * 5).toString()
  )

  console.log(
    '\x1b[30m\x1b[42m' + `tx: ${JSON.stringify(tx, null, 2)}` + '\x1b[0m'
  )

  // TODO: broaadcast...() START
  const receipt = await tx.wait()
  console.log(
    '\x1b[30m\x1b[42m' +
      `receipt: ${JSON.stringify(receipt, null, 2)}` +
      '\x1b[0m'
  )
}

testSwap()
