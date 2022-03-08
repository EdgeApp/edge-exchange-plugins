// @flow

import { FallbackProvider } from '@ethersproject/providers'
import { bns } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeMetaToken,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import {
  convertToDecimal,
  convertToHex,
  makeSwapPluginQuote
} from '../../swap-helpers.js'
import { type CachedPairData } from './dexTypes.js'
import {
  cachedPairDatas,
  SPOOKYSWAP_ROUTER_ABI,
  SPOOKYSWAP_ROUTER_ADDRESS,
  uniswapV2PairABI
} from './spookyContracts.js'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'spookySwap',
  displayName: 'SpookySwap',
  supportEmail: '',
  supportUrl: 'https://discord.com/invite/weXbvPAH4Q'
}
const expirationMs = 1000 * 20 * 60

const getWalletAddress = async (
  wallet: EdgeCurrencyWallet
): Promise<string> => {
  const addressInfo = await wallet.getReceiveAddress()

  return addressInfo.legacyAddress
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

/**
 * Check first if the LP exists in our constants. TODO: Call RPC server if not saved.
 */
export const getLpContract = async (
  tokenAddress0: string,
  tokenAddress1: string,
  pairDatas: CachedPairData[],
  provider: FallbackProvider
): Promise<ethers.Contract> => {
  const lpAddress = pairDatas.find(pairData =>
    pairData.tokenAddresses.every(pairTokenAddress => {
      return (
        tokenAddress0.toLowerCase() === pairTokenAddress.toLowerCase() ||
        tokenAddress1.toLowerCase() === pairTokenAddress.toLowerCase()
      )
    })
  )?.lpAddress

  if (lpAddress == null)
    throw new Error(
      `Could not find LP contract for tokens: ${tokenAddress0} ${tokenAddress1}`
    )

  return new ethers.Contract(lpAddress, uniswapV2PairABI, provider)
}

/**
 * Get the params that are dependent on token ordering.
 * Returns:
 * - The exchange rate of
 * tokenAddressToSwap * exchangeRate = expectedTokensOut
 * - The swap path
 */
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
    path: isFromToken0
      ? [fromTokenAddress, toTokenAddress]
      : [toTokenAddress, fromTokenAddress]
  }
}

export const getMetaTokenAddress = (
  metaTokens: EdgeMetaToken[],
  tokenCurrencyCode: string
): string => {
  const metaToken = metaTokens.find(mt => mt.currencyCode === tokenCurrencyCode)

  if (metaToken == null || metaToken?.contractAddress === undefined)
    throw new Error('Could not find contract address for ' + tokenCurrencyCode)

  return metaToken.contractAddress ?? ''
}

export const getRouterMethodName = (
  isFromNativeCurrency: boolean,
  isToNativeCurrency: boolean
): { routerMethodName: string, isAmountInParam: boolean } => {
  if (isFromNativeCurrency && isToNativeCurrency)
    throw new Error('Invalid swap: Cannot swap to the same native currency')

  // ABI: swapExactETHForTokens(
  //    uint amountOutMin,
  //    address[] calldata path,
  //    address
  //    to,
  //    uint deadline)
  //  external payable returns (uint[] memory amounts);
  if (isFromNativeCurrency)
    return {
      routerMethodName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
      isAmountInParam: false
    }
  // ABI: swapExactTokensForETHSupportingFeeOnTransferTokens(
  //   uint amountIn,
  //   uint amountOutMin,
  //   address[] calldata path,
  //   address to,
  //   uint deadline
  // ) external;
  else if (isToNativeCurrency)
    return {
      routerMethodName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
      isAmountInParam: true
    }
  // ABI: swapExactTokensForTokensSupportingFeeOnTransferTokens(
  //   uint amountIn,
  //   uint amountOutMin,
  //   address[] calldata path,
  //   address to,
  //   uint deadline
  // ) external;
  else
    return {
      routerMethodName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
      isAmountInParam: true
    }
}

export const getRouterTransaction = async (
  router: ethers.Contract,
  isFromNativeCurrency: boolean,
  isToNativeCurrency: boolean,
  amountOutMinNative: string,
  amountInNative: string,
  path: string[],
  receiveAddress: string,
  deadline: string
) => {
  const { routerMethodName, isAmountInParam } = getRouterMethodName(
    isFromNativeCurrency,
    isToNativeCurrency
  )

  if (isAmountInParam)
    return await router[routerMethodName](
      convertToHex(amountInNative),
      convertToHex(amountOutMinNative),
      path,
      receiveAddress,
      deadline,
      { gasLimit: 360000 } // TODO: not needed?
    )
  else
    return await router[routerMethodName](
      convertToHex(amountOutMinNative),
      path,
      receiveAddress,
      deadline,
      { gasLimit: 360000 } // TODO: not needed?
    )
}

export function makeSpookySwapPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { log } = opts

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapQuote> {
      log.warn(JSON.stringify(request, null, 2))
      const { fromWallet, toWallet, fromCurrencyCode, toCurrencyCode } = request
      const currencyInfo = fromWallet.currencyInfo

      // Sanity check: Both wallets should be of the same chain.
      if (
        fromWallet.currencyInfo.currencyCode !==
        toWallet.currencyInfo.currencyCode
      )
        throw new Error('SpookySwap: Mismatched wallet chain')

      // Create fallback providers
      const providers = []
      for (const rpcServer of currencyInfo.defaultSettings.otherSettings
        .rpcServers) {
        providers.push(new ethers.providers.JsonRpcProvider(rpcServer))
      }

      // Only one provider is required for quorum
      const fallbackProvider = new ethers.providers.FallbackProvider(
        providers,
        1
      )

      // Parse input/output token addresses. If either from or to swap sources
      // are for the native currency, convert the address to the wrapped equivalent.
      const nativeCurrencyCode = fromWallet.currencyInfo.currencyCode
      const isFromNativeCurrency = fromCurrencyCode === nativeCurrencyCode
      const isToNativeCurrency = toCurrencyCode === nativeCurrencyCode
      const wrappedCurrencyCode = `W${nativeCurrencyCode}`
      const metaTokens: EdgeMetaToken[] = fromWallet.currencyInfo.metaTokens

      const fromTokenAddress = getMetaTokenAddress(
        metaTokens,
        isFromNativeCurrency ? wrappedCurrencyCode : fromCurrencyCode
      )
      const toTokenAddress = getMetaTokenAddress(
        metaTokens,
        isToNativeCurrency ? wrappedCurrencyCode : toCurrencyCode
      )

      // Get LP contract and rates
      const lpContract = await getLpContract(
        fromTokenAddress,
        toTokenAddress,
        cachedPairDatas,
        fallbackProvider
      )
      const { exchangeRate, path } = await getRateAndPath(
        fromTokenAddress,
        toTokenAddress,
        lpContract
      )
      log.warn(
        '\x1b[34m\x1b[43m' +
          `lpRate: ${JSON.stringify({ exchangeRate, path }, null, 2)}` +
          '\x1b[0m'
      )

      // Calculate amounts
      const amountToSwap = request.nativeAmount
      const minAmount = '0.95' // slippage
      const expectedAmountOut = bns.mul(
        bns.mul(amountToSwap, exchangeRate.toString()),
        minAmount
      )
      log.warn(
        `\x1b[34m\x1b[43m{amountToSwap, expectedAmountOut}: 
          ${JSON.stringify(
            { amountToSwap, expectedAmountOut },
            null,
            2
          )}\x1b[0m`
      )

      const fromAddress = await getWalletAddress(fromWallet)
      const toAddress = await getWalletAddress(toWallet)
      const spookySwapRouter = new ethers.Contract(
        SPOOKYSWAP_ROUTER_ADDRESS,
        SPOOKYSWAP_ROUTER_ABI,
        new ethers.Wallet(fromWallet.displayPrivateSeed, fallbackProvider)
      )
      const routerTx = await getRouterTransaction(
        spookySwapRouter,
        isFromNativeCurrency,
        isToNativeCurrency,
        amountToSwap,
        expectedAmountOut,
        path,
        toAddress,
        `0x${(Math.floor(new Date().getTime() / 1000) + 60).toString(16)}`
      )

      // Convert to our spendInfo
      const edgeSpendInfo: EdgeSpendInfo = {
        pluginId: 'spookySwap',
        currencyCode: request.fromCurrencyCode, // what is being sent out, only if token. Blank if not token
        spendTargets: [
          {
            nativeAmount: amountToSwap.toString(), // biggy/number string integer
            publicAddress: SPOOKYSWAP_ROUTER_ADDRESS,

            otherParams: {
              data: routerTx.data
            }
          }
        ],
        customNetworkFee: {
          gasPrice: '700',
          gasLimit: '360000'
        },
        networkFeeOption: 'custom',
        // networkFeeOption: 'standard',
        swapData: {
          isEstimate: false,
          payoutAddress: toAddress,
          payoutCurrencyCode: request.toCurrencyCode,
          payoutNativeAmount: expectedAmountOut.toString(),
          payoutWalletId: request.toWallet.id,
          plugin: { ...swapInfo },
          refundAddress: fromAddress
        }
      }

      log.warn(
        '\x1b[34m\x1b[43m' +
          `edgeSpendInfo: ${JSON.stringify(edgeSpendInfo, null, 2)}` +
          '\x1b[0m'
      )

      const edgeUnsignedTx: EdgeTransaction = await request.fromWallet.makeSpend(
        edgeSpendInfo
      )

      // Convert that to the output format:
      return makeSwapPluginQuote(
        request,
        amountToSwap.toString(),
        expectedAmountOut.toString(),
        edgeUnsignedTx,
        toAddress,
        'spookySwap',
        true,
        new Date(Date.now() + expirationMs)
      )
    }
  }

  return out
}
