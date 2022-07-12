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
    gasLimit: ethers.utils.hexlify(170000),
    gasPrice: ethers.utils.parseUnits('3.5', 'gwei')
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
    fromTokenAddress,
    toCurrencyCode,
    toTokenAddress
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
  // const wrappedCurrencyCode = `W${nativeCurrencyCode}`

  // TODO: Do different wallets share the same custom metaTokens?
  // const metaTokens: EdgeMetaToken[] = currencyInfo.metaTokens

  // const fromTokenAddress = getMetaTokenAddress(
  //   metaTokens,
  //   isFromNativeCurrency ? wrappedCurrencyCode : fromCurrencyCode
  // )
  // const toTokenAddress = getMetaTokenAddress(
  //   metaTokens,
  //   isToNativeCurrency ? wrappedCurrencyCode : toCurrencyCode
  // )

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
 * Test swap fn
 */
type TestSwapParams = {
  nativeCurrency: string,
  fromCurrencyCode: string,
  fromTokenAddress: string,
  toTokenAddress: string,
  toCurrencyCode: string,
  amount: string, // in native
  fromPrivateKey: string,
  receiveAddress: string
}
const testSwap = async (testSwapParams: TestSwapParams) => {
  const {
    nativeCurrency,
    fromCurrencyCode,
    fromTokenAddress,
    toTokenAddress,
    toCurrencyCode,
    amount, // in native
    fromPrivateKey,
    receiveAddress
  } = testSwapParams

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
    fromCurrencyCode,
    fromTokenAddress,
    toCurrencyCode,
    toTokenAddress,

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

/**
 * Swap into multiple tokens
 */
const testSwaps = async (swapTargets: any) => {
  for (const swapTarget of swapTargets) {
    await testSwap({
      nativeCurrency: 'FTM',
      fromCurrencyCode: 'FTM',
      fromTokenAddress: '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83',
      toTokenAddress: swapTarget.toTokenAddress,
      toCurrencyCode: swapTarget.toCurrencyCode,
      amount: '10000000000000000000', // Swap 10 FTM for each token
      fromPrivateKey:
        'a609cd0029cef4959727977412b253f2cd90c253847688d1cfb695f389cda838',
      receiveAddress: '0x93723056de77c9065209b0fc6ca00dd3c95ada18'
    })
    console.log(
      '\x1b[30m\x1b[42m\n' +
        'Finished ' +
        swapTarget.toCurrencyCode +
        '\n\n\x1b[0m'
    )
  }
}

const swapTargets = [
  // {
  //   toTokenAddress: '0x6c021ae822bea943b2e66552bde1d2696a53fbb7',
  //   toCurrencyCode: 'TOMB'
  // },
  // {
  //   toTokenAddress: '0x04068da6c83afcfa0e13ba15a6696662335d5b75',
  //   toCurrencyCode: 'USDC'
  // },
  // {
  //   toTokenAddress: '0x09e145a1d53c0045f41aeef25d8ff982ae74dd56',
  //   toCurrencyCode: 'ZOO'
  // },
  // {
  //   toTokenAddress: '0x321162cd933e2be498cd2267a90534a804051b11',
  //   toCurrencyCode: 'BTC'
  // },
  // {
  //   toTokenAddress: '0x4cdf39285d7ca8eb3f090fda0c069ba5f4145b37',
  //   toCurrencyCode: 'TSHARE'
  // },
  // {
  //   toTokenAddress: '0x74b23882a30290451a17c44f4f05243b6b58c76d',
  //   toCurrencyCode: 'ETH'
  // },
  // {
  //   toTokenAddress: '0x049d68029688eabf473097a2fc38ef61633a3c7a',
  //   toCurrencyCode: 'FUSDT'
  // },
  // {
  //   toTokenAddress: '0x82f0b8b456c1a451378467398982d4834b6829c1',
  //   toCurrencyCode: 'MIM'
  // },
  // {
  //   toTokenAddress: '0x8d11ec38a3eb5e956b052f67da8bdc9bef8abf3e',
  //   toCurrencyCode: 'DAI'
  // },
  // {
  //   toTokenAddress: '0xbf60e7414ef09026733c1e7de72e7393888c64da',
  //   toCurrencyCode: 'LIF3'
  // },
  // {
  //   toTokenAddress: '0xcbe0ca46399af916784cadf5bcc3aed2052d6c45',
  //   toCurrencyCode: 'LSHARE'
  // },
  // {
  //   toTokenAddress: '0xd67de0e0a0fd7b15dc8348bb9be742f3c5850454',
  //   toCurrencyCode: 'BNB'
  // },
  // {
  //   toTokenAddress: '0x511d35c52a3c244e7b8bd92c0c297755fbd89212',
  //   toCurrencyCode: 'AVAX'
  // },
  // {
  //   toTokenAddress: '0xb3654dc3d10ea7645f8319668e8f54d2574fbdc8',
  //   toCurrencyCode: 'LINK'
  // },
  // {
  //   toTokenAddress: '0x1e4f97b9f9f913c46f1632781732927b9019c68b',
  //   toCurrencyCode: 'CRV'
  // },
  // {
  //   toTokenAddress: '0x24248cd1747348bdc971a5395f4b3cd7fee94ea0',
  //   toCurrencyCode: 'TBOND'
  // }

  // No direct swap route for the tokens below!
  {
    // WFTM -> TOMB -> TREEB
    toTokenAddress: '0xc60d7067dfbc6f2caf30523a064f416a5af52963',
    toCurrencyCode: 'TREEB'
  },
  {
    // WFTM -> LIV3 -> USDC -> FUSD
    toTokenAddress: '0xad84341756bf337f5a0164515b1f6f993d194e1f',
    toCurrencyCode: 'FUSD'
  }
]

// Swap into the token array
testSwaps(swapTargets)
