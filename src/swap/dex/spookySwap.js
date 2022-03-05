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

const getAddress = async (wallet: EdgeCurrencyWallet): Promise<string> => {
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
        tokenAddress0.toUpperCase() === pairTokenAddress.toUpperCase() ||
        tokenAddress1.toUpperCase() === pairTokenAddress.toUpperCase()
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
 * Returns the exchange rate of
 * tokenAddressToSwap * exchangeRate = expectedTokensOut
 */
export async function getRate(
  tokenFrom: string,
  tokenTo: string,
  lpContract: ethers.Contract
): Promise<number> {
  const exchangeRate = await lpContract
    .getReserves()
    .then(reserves => Number(reserves._reserve0) / Number(reserves._reserve1))

  // Check if the token being swapped is the 0 or 1 token index and invert the
  // rate if needed.
  // token1's address as a value literal is always less than token1's address value
  return convertToDecimal(tokenFrom) > convertToDecimal(tokenTo)
    ? 1 / exchangeRate
    : exchangeRate
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

export const getRouterMethod = (
  isFromNativeCurrency: boolean,
  isToNativeCurrency: boolean
): string => {
  if (isFromNativeCurrency && isToNativeCurrency)
    throw new Error('Cannot swap to the same native currency')

  if (isFromNativeCurrency) return 'swapExactETHForTokens'
  else if (isToNativeCurrency) return 'swapExactTokensForEth'
  else return 'swapExactTokensForTokens'
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

      // Create Router
      const ethersWallet = new ethers.Wallet(
        fromWallet.displayPrivateSeed,
        fallbackProvider
      )
      const spookySwapRouter = new ethers.Contract(
        SPOOKYSWAP_ROUTER_ADDRESS,
        SPOOKYSWAP_ROUTER_ABI,
        ethersWallet
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
      log.warn(
        '\x1b[34m\x1b[43m' +
          `{fromTokenAddress, toTokenAddress}: ${JSON.stringify(
            { fromTokenAddress, toTokenAddress },
            null,
            2
          )}` +
          '\x1b[0m'
      )

      // Get LP contract and rates
      const lpContract = await getLpContract(
        fromTokenAddress,
        toTokenAddress,
        cachedPairDatas,
        fallbackProvider
      )
      const exchangeRate = await getRate(
        fromTokenAddress,
        toTokenAddress,
        lpContract
      )
      log.warn(
        '\x1b[34m\x1b[43m' +
          `lpRate: ${JSON.stringify(exchangeRate, null, 2)}` +
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
        '\x1b[34m\x1b[43m' +
          `{amountToSwap, expectedAmountOut}: ${JSON.stringify(
            { amountToSwap, expectedAmountOut },
            null,
            2
          )}` +
          '\x1b[0m'
      )

      // Determine the router method
      const routerMethod = getRouterMethod(
        isFromNativeCurrency,
        isToNativeCurrency
      )
      log.warn(
        '\x1b[34m\x1b[43m' +
          `routerMethod: ${JSON.stringify(routerMethod, null, 2)}` +
          '\x1b[0m'
      )
      const path =
        convertToDecimal(fromTokenAddress) > convertToDecimal(toTokenAddress)
          ? [fromTokenAddress, toTokenAddress]
          : [toTokenAddress, fromTokenAddress]
      const fromAddress = await getAddress(fromWallet)
      const toAddress = await getAddress(toWallet)

      const routerTx = await spookySwapRouter[routerMethod](
        convertToHex(amountToSwap),
        convertToHex(expectedAmountOut),
        path,
        toAddress,
        `0x${(Math.floor(new Date().getTime() / 1000) + 60).toString(16)}`,
        { gasLimit: 360000 }
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
        false, // TODO: is this right or even needed?
        new Date(Date.now() + expirationMs)
      )
    }
  }

  return out
}
