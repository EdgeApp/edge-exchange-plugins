/* eslint-disable no-console */
// @flow

import { FallbackProvider } from '@ethersproject/providers'
import { type EdgeMetaToken } from 'edge-core-js/types'
import { ethers, Transaction } from 'ethers'

import { type RouterTxProviderMap } from './dexTypes.js'
import {
  SPOOKYSWAP_ROUTER_ABI,
  SPOOKYSWAP_ROUTER_ADDRESS,
  uniswapV2PairABI
} from './spookyContracts.js'

/**
 * Check first if the LP address exists in our cached data.
 * If not found, try to query the factory smart contract.
 *
 * TODO: May not be needed...
 * Can probably calculate rates from the router's getAmountsOut()
 */
const getLpContract = async (
  tokenAddress0,
  tokenAddress1,
  cachedPairDatas,
  rpcProvider: FallbackProvider,
  factory: ethers.Contract
): ethers.Contract => {
  let foundPairData = cachedPairDatas.find(cachedPairData =>
    cachedPairData.tokenAddresses.every(pairTokenAddress => {
      return (
        tokenAddress0.toUpperCase() === pairTokenAddress.toUpperCase() ||
        tokenAddress1.toUpperCase() === pairTokenAddress.toUpperCase()
      )
    })
  )

  // Try to query the factory contract for the LP address
  if (foundPairData == null) {
    try {
      foundPairData = await factory.getPair(tokenAddress0, tokenAddress1)
      if (foundPairData === null) throw new Error('No pair result from factory')
    } catch (e) {
      throw new Error(
        `Could not find LP address for tokens: ${tokenAddress0} ${tokenAddress1} (${JSON.stringify(
          e
        )})`
      )
    }
  }

  const lpAddress = foundPairData.lpAddress
  return new ethers.Contract(lpAddress, uniswapV2PairABI, rpcProvider)
}

const getMetaTokenAddress = (
  metaTokens: EdgeMetaToken[],
  tokenCurrencyCode: string
): string => {
  const metaToken = metaTokens.find(mt => mt.currencyCode === tokenCurrencyCode)

  if (metaToken == null || metaToken?.contractAddress === undefined)
    throw new Error('Could not find contract address for ' + tokenCurrencyCode)

  return metaToken.contractAddress ?? ''
}

/**
 * Calls upon the router (with sign privileges) to generate a signed swap transaction.
 */
const RouterTxProviders = (
  router: ethers.Contract,
  path: string[],
  swapAmount: ethers.BigNumber,
  receiveAddress: string,
  deadline: string
): RouterTxProviderMap => {
  const hexZero = '0x00'

  // TODO: Do gasLimit, gasPrice, and value get set properly from accountbased on the resulting tx?
  // TODO: OR do we need to grab fees from accountbased and populate this here?
  const networkFees = {
    gasLimit: ethers.utils.hexlify(340722),
    gasPrice: ethers.utils.parseUnits('661', 'gwei')
  }

  return {
    swapExactETHForTokens: (minReceivedTokens?) =>
      router.swapExactETHForTokens(
        minReceivedTokens?.toHexString() ?? hexZero,
        path,
        receiveAddress,
        deadline,
        {
          ...networkFees,
          value: swapAmount.toHexString()
        }
      ),
    swapExactTokensForETH: (minReceivedEth?) =>
      router.swapExactTokensForETH(
        swapAmount.toHexString(),
        minReceivedEth?.toHexString() ?? hexZero,
        path,
        receiveAddress,
        deadline,
        networkFees
      ),
    swapExactTokensForTokens: (minReceivedTokens?) =>
      router.swapExactTokensForTokens(
        swapAmount.toHexString(),
        minReceivedTokens?.toHexString() ?? hexZero,
        path,
        receiveAddress,
        deadline,
        networkFees
      )
  }
}

/**
 * Translate our swap params into what the router smart contract needs to
 * perform the swap.
 */
const getRouterSwapParams = async (edgeSwapRequest: any) => {
  const {
    fromWallet,
    toWallet,
    fromCurrencyCode,
    toCurrencyCode
  } = edgeSwapRequest
  const currencyInfo = fromWallet.currencyInfo

  // Sanity check: Both wallets should be of the same chain.
  if (
    fromWallet.currencyInfo.currencyCode !== toWallet.currencyInfo.currencyCode
  )
    throw new Error('SpookySwap: Mismatched wallet chain')

  // TODO: Use our new denom implementation to get native amounts
  const nativeCurrencyCode = currencyInfo.currencyCode
  const isFromNativeCurrency = fromCurrencyCode === nativeCurrencyCode
  const isToNativeCurrency = toCurrencyCode === nativeCurrencyCode
  const wrappedCurrencyCode = `W${nativeCurrencyCode}`

  // TODO: Do different wallets share the same custom metaTokens?
  const metaTokens: EdgeMetaToken[] = currencyInfo.metaTokens

  const fromTokenAddress = getMetaTokenAddress(
    metaTokens,
    isFromNativeCurrency ? wrappedCurrencyCode : fromCurrencyCode
  )
  const toTokenAddress = getMetaTokenAddress(
    metaTokens,
    isToNativeCurrency ? wrappedCurrencyCode : toCurrencyCode
  )

  // Determine router method name and params
  if (isFromNativeCurrency && isToNativeCurrency)
    throw new Error('Invalid swap: Cannot swap to the same native currency')
  const path = [fromTokenAddress, toTokenAddress]
  const swapAmount = ethers.BigNumber.from(edgeSwapRequest.nativeAmount)

  if (isFromNativeCurrency && !isToNativeCurrency)
    return {
      routerMethodName: 'swapExactETHForTokens',
      path: path,
      swapAmount
    }
  if (!isFromNativeCurrency && isToNativeCurrency)
    return {
      routerMethodName: 'swapExactTokensForETH',
      path: path,
      swapAmount
    }
  if (!isFromNativeCurrency && !isToNativeCurrency)
    return {
      routerMethodName: 'swapExactTokensForTokens',
      path: path,
      swapAmount
    }
  // TODO: Add wrap/unwrap methods
  else throw new Error('Unhandled swap type')
}

const generateSignedSwapTx = async (
  swapRouter: ethers.Contract,
  swapAmount: ethers.BigNumber,
  routerMethodName: string,
  receiveAddress: string,
  path: string[]
): Promise<Transaction> => {
  // Get an estimated amount to receive
  const receiveAmount = await swapRouter
    .getAmountsOut(swapAmount, path)
    .then(getAmountsOutRes => {
      // eslint-disable-next-line no-unused-vars
      const [_inputBN, outputBN] = getAmountsOutRes
      // 1% -ish slippage
      return outputBN.sub(outputBN.div(99))
    })

  const routerFns = RouterTxProviders(
    swapRouter,
    path,
    swapAmount,
    receiveAddress,
    (Math.floor(Date.now() / 1000) + 60 * 5).toString()
  )

  return await routerFns[routerMethodName](receiveAmount)
}

/**
 * Test fn
 */
const testSwap = async (
  nativeCurrency: string,
  fromCurrency: string,
  toCurrency: string,
  amount: string, // in native
  fromPrivateKey: string,
  fromAddress: string,
  receiveAddress: string
) => {
  const testSwapRequest = {
    fromWallet: {
      currencyInfo: {
        currencyCode: nativeCurrency,
        metaTokens: [
          {
            currencyCode: 'WFTM',
            currencyName: 'Wrapped Fantom',
            denominations: [
              {
                name: 'WFTM',
                multiplier: '1000000000000000000'
              }
            ],
            contractAddress: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83'
          },
          {
            currencyCode: 'BOO',
            currencyName: 'SpookyToken',
            denominations: [
              {
                name: 'BOO',
                multiplier: '1000000000000000000'
              }
            ],
            contractAddress: '0x841fad6eae12c286d1fd18d1d525dffa75c7effe'
          },
          {
            currencyCode: 'TOMB',
            currencyName: 'Tomb',
            denominations: [
              {
                name: 'TOMB',
                multiplier: '1000000000000000000'
              }
            ],
            contractAddress: '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7'
          }
        ]
      }
    },
    toWallet: {
      currencyInfo: {
        currencyCode: nativeCurrency
      }
    },

    // What?
    fromCurrencyCode: fromCurrency,
    toCurrencyCode: toCurrency,

    // How much?
    nativeAmount: amount,
    quoteFor: 'from'
  }
  // Create fallback providers
  const rpcProviderUrls = [
    // 'https://rpcapi.fantom.network',
    // 'https://rpc.fantom.network',
    // 'https://rpc2.fantom.network',
    // 'https://rpc3.fantom.network',
    'https://rpc.ftm.tools'
  ]
  const providers = []
  for (const rpcServer of rpcProviderUrls) {
    providers.push(new ethers.providers.JsonRpcProvider(rpcServer))
  }

  // Only one provider is required for quorum
  const fallbackProvider = new ethers.providers.FallbackProvider(providers, 1)

  // Get the router method and params
  const { swapAmount, routerMethodName, path } = await getRouterSwapParams(
    testSwapRequest
  )
  console.log(
    '\x1b[37m\x1b[41m' +
      `{swapAmount, routerMethodName, path}: ${JSON.stringify(
        { swapAmount, routerMethodName, path },
        null,
        2
      )}` +
      '\x1b[0m'
  )

  // Generate signed swap tx using a provided router
  const swapRouter = new ethers.Contract(
    SPOOKYSWAP_ROUTER_ADDRESS,
    SPOOKYSWAP_ROUTER_ABI,
    new ethers.Wallet(fromPrivateKey, fallbackProvider)
  )

  const tx = await generateSignedSwapTx(
    swapRouter,
    swapAmount,
    routerMethodName,
    receiveAddress,
    path
  )
  console.log(
    '\x1b[30m\x1b[42m' + `tx: ${JSON.stringify(tx, null, 2)}` + '\x1b[0m'
  )

  // Broadcast the TX
  const broadcastRes = await tx.wait()
  console.log(
    '\x1b[37m\x1b[44m' +
      `broadcastRes: ${JSON.stringify(broadcastRes, null, 2)}` +
      '\x1b[0m'
  )
}

testSwap(
  'FTM', // nativeCurrency
  'BOO', // fromCurrency
  'FTM', // toCurrency
  '10000000000000000', // 0.01 amount
  '1f25216e2b05a01857eeb4936bca1e615da301c0932927b71f5e29e6ec1e1cb9', // fromPrivateKey
  '0x749411cf4DA88194581921Ae55f6fc4357D3b0f2', // fromAddress
  '0x749411cf4DA88194581921Ae55f6fc4357D3b0f2'
) // receiveAddress
