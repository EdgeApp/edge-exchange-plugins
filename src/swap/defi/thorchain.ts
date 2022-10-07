import { add, div, lt, mul, sub, toFixed } from 'biggystring'
import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'
import { ethers } from 'ethers'

import {
  checkInvalidCodes,
  InvalidCurrencyCodes,
  isLikeKind,
  makeSwapPluginQuote
} from '../../swap-helpers'
import { fetchInfo, fetchWaterfall, promiseWithTimeout } from '../../util/utils'
import abi from './abi/THORCHAIN_SWAP_ABI'
import erc20Abi from './abi/UNISWAP_V2_ERC20_ABI'

const pluginId = 'thorchain'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Thorchain',
  supportEmail: 'support@edge.app'
}

const EXPIRATION_MS = 1000 * 60
const MIDGARD_SERVERS_DEFAULT = ['https://midgard.thorchain.info']
const NINEREALMS_SERVERS_DEFAULT = ['https://api.ninerealms.com']
const DIVIDE_PRECISION = 16
const AFFILIATE_FEE_BASIS_DEFAULT = '50'
const THORNAME_DEFAULT = 'ej'
const VOLATILITY_SPREAD_DEFAULT = 0.01
const LIKE_KIND_VOLATILITY_SPREAD_DEFAULT = 0.0025
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
const EVM_SEND_GAS = '80000'
const EVM_TOKEN_SEND_GAS = '80000'
export const THOR_LIMIT_UNITS = '100000000'

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

const EVM_CURRENCY_CODES: { [cc: string]: boolean } = {
  ETH: true,
  AVAX: true,
  FTM: true,
  ETC: true,
  BCH: false,
  BNB: false,
  BTC: false,
  LTC: false,
  THOR: false,
  DOGE: false
}

// Network names that don't match parent network currency code
const MAINNET_CODE_TRANSCRIPTION: { [cc: string]: ChainTypes } = {
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  binancechain: 'BNB',
  litecoin: 'LTC',
  ethereum: 'ETH',
  dogecoin: 'DOGE',
  avalanche: 'AVAX',
  thorchain: 'THOR'
}

const asMinAmount = asObject({
  minInputAmount: asString
})

const asInboundAddresses = asArray(
  asObject({
    address: asString,
    chain: asString,
    gas_rate: asString,
    halted: asBoolean,
    pub_key: asString,
    router: asOptional(asString)
  })
)

export const asPool = asObject({
  asset: asString,
  status: asString,
  assetPrice: asString,
  assetPriceUSD: asString,
  assetDepth: asString,
  runeDepth: asString
})

const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      thorchain: asObject({
        volatilitySpread: asNumber,
        likeKindVolatilitySpread: asNumber,
        midgardServers: asArray(asString),
        nineRealmsServers: asOptional(asArray(asString))
      })
    })
  })
})

const asCustomFeeSettings = asArray(asString)

const asPools = asArray(asPool)

type Pool = ReturnType<typeof asPool>
type ExchangeInfo = ReturnType<typeof asExchangeInfo>
type MinAmount = ReturnType<typeof asMinAmount>

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0

export function makeThorchainPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io, log } = opts
  const { fetch } = io
  const {
    thorname = THORNAME_DEFAULT,
    affiliateFeeBasis = AFFILIATE_FEE_BASIS_DEFAULT
  } = initOptions
  // eslint-disable-next-line no-console
  const affiliateFee = div(affiliateFeeBasis, '10000', DIVIDE_PRECISION)

  const headers = {
    'Content-Type': 'application/json'
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const {
        fromCurrencyCode,
        toCurrencyCode,
        nativeAmount,
        fromWallet,
        toWallet,
        quoteFor
      } = request
      const likeKind = isLikeKind(fromCurrencyCode, toCurrencyCode)

      let midgardServers: string[] = MIDGARD_SERVERS_DEFAULT
      let nineRealmsServers: string[] = NINEREALMS_SERVERS_DEFAULT
      let likeKindVolatilitySpread: number = LIKE_KIND_VOLATILITY_SPREAD_DEFAULT
      let volatilitySpread: number = VOLATILITY_SPREAD_DEFAULT

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      // Grab addresses:
      const fromAddress = await getAddress(fromWallet, fromCurrencyCode)
      const toAddress = await getAddress(toWallet, toCurrencyCode)

      const fromMainnetCode =
        MAINNET_CODE_TRANSCRIPTION[fromWallet.currencyInfo.pluginId]
      const toMainnetCode =
        MAINNET_CODE_TRANSCRIPTION[toWallet.currencyInfo.pluginId]

      if (fromMainnetCode == null || toMainnetCode == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      const now = Date.now()
      if (
        now - exchangeInfoLastUpdate > EXCHANGE_INFO_UPDATE_FREQ_MS ||
        exchangeInfo == null
      ) {
        try {
          const exchangeInfoResponse = await promiseWithTimeout(
            fetchInfo(fetch, 'v1/exchangeInfo/edge')
          )

          if (exchangeInfoResponse.ok === true) {
            exchangeInfo = asExchangeInfo(await exchangeInfoResponse.json())
            exchangeInfoLastUpdate = now
          } else {
            // Error is ok. We just use defaults
            log('Error getting info server exchangeInfo. Using defaults...')
          }
        } catch (e: any) {
          log(
            'Error getting info server exchangeInfo. Using defaults...',
            e.message
          )
        }
      }

      if (exchangeInfo != null) {
        likeKindVolatilitySpread =
          exchangeInfo.swap.plugins.thorchain.likeKindVolatilitySpread
        volatilitySpread = exchangeInfo.swap.plugins.thorchain.volatilitySpread
        midgardServers = exchangeInfo.swap.plugins.thorchain.midgardServers
        nineRealmsServers =
          exchangeInfo.swap.plugins.thorchain.nineRealmsServers ??
          nineRealmsServers
      }

      const volatilitySpreadFinal = likeKind
        ? likeKindVolatilitySpread.toString()
        : volatilitySpread.toString()

      // Get current pool
      const [iaResponse, poolResponse, minAmountResponse] = await Promise.all([
        fetchWaterfall(
          fetch,
          midgardServers,
          'v2/thorchain/inbound_addresses',
          {
            headers
          }
        ),
        fetchWaterfall(fetch, midgardServers, 'v2/pools', { headers }),
        fetchWaterfall(
          fetch,
          nineRealmsServers,
          `thorchain/swap/minAmount?inAsset=${fromMainnetCode}.${fromCurrencyCode}&outAsset=${toMainnetCode}.${toCurrencyCode}`
        ).catch(e => {
          log(e.message)
        })
      ])

      if (iaResponse.ok === false) {
        const responseText = await iaResponse.text()
        throw new Error(
          `Thorchain could not fetch inbound_addresses: ${responseText}`
        )
      }
      if (poolResponse.ok === false) {
        const responseText = await poolResponse.text()
        throw new Error(`Thorchain could not fetch pools: ${responseText}`)
      }
      let minAmount
      try {
        if (minAmountResponse == null)
          throw new Error('Failed to get minAmount')
        const responseJson = await minAmountResponse.json()
        minAmount = asMinAmount(responseJson)
      } catch (e) {
        log('Failed to get minAmount')
      }

      const iaJson = await iaResponse.json()
      const inboundAddresses = asInboundAddresses(iaJson)

      const poolJson = await poolResponse.json()
      const pools = asPools(poolJson)

      // Check for supported chain and asset
      const inAddressObject = inboundAddresses.find(
        addrObj => !addrObj.halted && addrObj.chain === fromMainnetCode
      )
      if (inAddressObject == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
      const { address: thorAddress, gas_rate: gasRate } = inAddressObject
      log(`${fromMainnetCode}.${fromCurrencyCode} gasRate ${gasRate}`)

      const outAddressObject = inboundAddresses.find(
        addrObj => !addrObj.halted && addrObj.chain === toMainnetCode
      )
      if (outAddressObject == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
      const { gas_rate: outboundGasRate } = outAddressObject
      log(
        `${toMainnetCode}.${toCurrencyCode} outboundGasRate ${outboundGasRate}`
      )

      const sourcePool = pools.find(pool => {
        const [asset] = pool.asset.split('-')
        return asset === `${fromMainnetCode}.${fromCurrencyCode}`
      })
      if (sourcePool == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
      const [
        sourceAsset,
        sourceTokenContractAddressAllCaps
      ] = sourcePool.asset.split('-')
      const sourceTokenContractAddress =
        sourceTokenContractAddressAllCaps != null
          ? sourceTokenContractAddressAllCaps.toLowerCase()
          : undefined
      log(`sourceAsset: ${sourceAsset}`)

      const destPool = pools.find(pool => {
        const [asset] = pool.asset.split('-')
        return asset === `${toMainnetCode}.${toCurrencyCode}`
      })
      if (destPool == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      // Add outbound fee
      const networkFee = calcNetworkFee(
        toMainnetCode,
        toCurrencyCode,
        outboundGasRate,
        pools
      )

      // Per Thorchain specs, user pays 2x the outbound transaction networkfee
      let feeInDestCurrency = mul(networkFee, '2')
      log(`feeInDestCurrency: ${feeInDestCurrency}`)

      const assetInUsd = mul(feeInDestCurrency, destPool.assetPriceUSD)
      if (lt(assetInUsd, '1')) {
        feeInDestCurrency = div('1', destPool.assetPriceUSD, DIVIDE_PRECISION)
        log(`feeInDestCurrency adjusted to $1 min: ${feeInDestCurrency}`)
      }

      let calcResponse
      if (quoteFor === 'from') {
        calcResponse = await calcSwapFrom(
          {
            fromWallet,
            fromCurrencyCode,
            toWallet,
            toCurrencyCode,
            nativeAmount,
            minAmount,
            sourcePool,
            destPool,
            volatilitySpreadFinal,
            affiliateFee,
            feeInDestCurrency
          },
          log
        )
      } else {
        calcResponse = await calcSwapTo(
          {
            fromWallet,
            fromCurrencyCode,
            toWallet,
            toCurrencyCode,
            nativeAmount,
            minAmount,
            sourcePool,
            destPool,
            volatilitySpreadFinal,
            affiliateFee,
            feeInDestCurrency
          },
          log
        )
      }
      const { fromNativeAmount, toNativeAmount, limit } = calcResponse

      let customNetworkFee
      let customNetworkFeeKey

      const customFeeTemplate = (fromWallet.currencyInfo.customFeeTemplate ??
        [])[0]
      const fromCurrencyInfo = fromWallet.currencyInfo
      if (customFeeTemplate?.type === 'nativeAmount') {
        customNetworkFee = gasRate
        customNetworkFeeKey = customFeeTemplate.key
      } else if (fromCurrencyInfo.defaultSettings?.customFeeSettings != null) {
        const customFeeSettings = asCustomFeeSettings(
          fromCurrencyInfo.defaultSettings.customFeeSettings
        )
        // Only know about the key 'gasPrice'
        const usesGasPrice = customFeeSettings.find(f => f === 'gasPrice')
        if (usesGasPrice != null) {
          customNetworkFee = gasRate
          customNetworkFeeKey = 'gasPrice'
        }
      }

      if (customNetworkFee == null || customNetworkFeeKey == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      let memo = buildSwapMemo({
        chain: toMainnetCode,
        asset: toCurrencyCode,
        address: toAddress,
        limit,
        affiliateAddress: thorname,
        points: affiliateFeeBasis
      })

      let ethNativeAmount = fromNativeAmount
      let publicAddress = thorAddress
      let approvalData
      if (EVM_CURRENCY_CODES[fromMainnetCode]) {
        if (fromMainnetCode !== fromCurrencyCode) {
          const { router, address } = inAddressObject
          if (router == null)
            throw new Error(`Missing router address for ${fromMainnetCode}`)
          if (sourceTokenContractAddress == null)
            throw new Error(
              `Missing sourceTokenContractAddress for ${fromMainnetCode}`
            )
          // Need to use ethers.js to craft a proper tx that calls Thorchain contract, then extract the data payload
          memo = await getEvmTokenData({
            assetAddress: sourceTokenContractAddress,
            amountToSwapWei: Number(fromNativeAmount),
            contractAddress: router,
            vaultAddress: address,
            memo
          })

          // Token transactions send no ETH (or other EVM mainnet coin)
          ethNativeAmount = '0'
          publicAddress = router

          // Check if token approval is required and return necessary data field
          approvalData = await getApprovalData({
            contractAddress: router,
            assetAddress: sourceTokenContractAddress,
            publicAddress: fromAddress,
            nativeAmount: fromNativeAmount
          })
        } else {
          memo = '0x' + Buffer.from(memo).toString('hex')
        }
      } else {
        // Cannot yet do tokens on non-EVM chains
        if (fromMainnetCode !== fromCurrencyCode) {
          throw new SwapCurrencyError(
            swapInfo,
            fromCurrencyCode,
            toCurrencyCode
          )
        }
      }

      let preTx: EdgeTransaction | undefined
      if (approvalData != null) {
        const spendInfo: EdgeSpendInfo = {
          currencyCode: request.fromCurrencyCode,
          spendTargets: [
            {
              memo: approvalData,
              nativeAmount: '0',
              publicAddress: sourceTokenContractAddress
            }
          ],
          networkFeeOption: 'custom',
          customNetworkFee: {
            [customNetworkFeeKey]: customNetworkFee
          },
          metadata: {
            name: 'Thorchain',
            category: 'expense:Token Approval'
          }
        }
        preTx = await request.fromWallet.makeSpend(spendInfo)
      }

      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            memo,
            nativeAmount: ethNativeAmount,
            publicAddress
          }
        ],
        networkFeeOption: 'custom',
        customNetworkFee: {
          [customNetworkFeeKey]: customNetworkFee
        },

        swapData: {
          isEstimate: false,
          payoutAddress: toAddress,
          payoutCurrencyCode: toCurrencyCode,
          payoutNativeAmount: toNativeAmount,
          payoutWalletId: toWallet.id,
          plugin: { ...swapInfo }
        },
        otherParams: {
          outputSort: 'targets'
        }
      }

      if (EVM_CURRENCY_CODES[fromMainnetCode]) {
        if (fromMainnetCode === fromCurrencyCode) {
          // For mainnet coins of EVM chains, use gasLimit override since makeSpend doesn't
          // know how to estimate an ETH spend with extra data
          const gasLimit = getGasLimit(fromMainnetCode, fromCurrencyCode)
          if (gasLimit != null) {
            spendInfo.customNetworkFee = {
              ...spendInfo.customNetworkFee,
              gasLimit
            }
          }
        }
      }
      const tx: EdgeTransaction = await request.fromWallet.makeSpend(spendInfo)

      return makeSwapPluginQuote(
        request,
        fromNativeAmount,
        toNativeAmount,
        tx,
        toAddress,
        pluginId,
        false,
        new Date(Date.now() + EXPIRATION_MS),
        tx.txid,
        preTx
      )
    }
  }
  return out
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.publicAddress
}

interface BuildSwapMemoParams {
  chain: string
  asset: string
  address: string
  limit: string
  affiliateAddress: string
  points: string
}

const calcSwapFrom = async (
  params: {
    fromWallet: EdgeCurrencyWallet
    fromCurrencyCode: string
    toWallet: EdgeCurrencyWallet
    toCurrencyCode: string
    nativeAmount: string
    minAmount: MinAmount | undefined
    sourcePool: Pool
    destPool: Pool
    volatilitySpreadFinal: string
    affiliateFee: string
    feeInDestCurrency: string
    dontCheckLimits?: boolean
  },
  log: Function
): Promise<{
  fromNativeAmount: string
  fromExchangeAmount: string
  toNativeAmount: string
  toExchangeAmount: string
  limit: string
}> => {
  const {
    fromWallet,
    fromCurrencyCode,
    toWallet,
    toCurrencyCode,
    nativeAmount,
    minAmount,
    sourcePool,
    destPool,
    volatilitySpreadFinal,
    affiliateFee,
    feeInDestCurrency,
    dontCheckLimits = false
  } = params
  const fromNativeAmount = nativeAmount

  // Get exchange rate from source to destination asset
  const fromExchangeAmount = await fromWallet.nativeToDenomination(
    nativeAmount,
    fromCurrencyCode
  )

  log(`fromExchangeAmount: ${fromExchangeAmount}`)

  // Check minimums if we can
  if (!dontCheckLimits && minAmount != null) {
    if (lt(fromExchangeAmount, minAmount.minInputAmount)) {
      const fromMinNativeAmount = await fromWallet.denominationToNative(
        minAmount.minInputAmount,
        fromCurrencyCode
      )

      throw new SwapBelowLimitError(swapInfo, fromMinNativeAmount, 'from')
    }
  }

  const result = calcDoubleSwapOutput(
    Number(mul(fromExchangeAmount, THOR_LIMIT_UNITS)),
    sourcePool,
    destPool
  )

  let toExchangeAmount = div(
    result.toString(),
    THOR_LIMIT_UNITS,
    DIVIDE_PRECISION
  )
  log(`toExchangeAmount: ${toExchangeAmount}`)

  const subVolatility = mul(toExchangeAmount, volatilitySpreadFinal)
  const subAffiliateFee = mul(toExchangeAmount, affiliateFee)

  toExchangeAmount = sub(toExchangeAmount, subVolatility)
  log(
    `toExchangeAmount w/volatilitySpread of ${mul(
      volatilitySpreadFinal,
      '100'
    )}%: ${toExchangeAmount}`
  )
  toExchangeAmount = sub(toExchangeAmount, subAffiliateFee)
  log(
    `toExchangeAmount w/affiliate fee of ${mul(
      affiliateFee,
      '100'
    )}%: ${toExchangeAmount}`
  )
  toExchangeAmount = sub(toExchangeAmount, feeInDestCurrency)
  log(
    `toExchangeAmount w/network fee of ${feeInDestCurrency}: ${toExchangeAmount}`
  )

  const toNativeAmountFloat = await toWallet.denominationToNative(
    toExchangeAmount,
    toCurrencyCode
  )
  const toNativeAmount = toFixed(toNativeAmountFloat, 0, 0)
  log(`toNativeAmount: ${toNativeAmount}`)
  const limit = toFixed(mul(toExchangeAmount, THOR_LIMIT_UNITS), 0, 0)
  log(`limit: ${limit}`)

  return {
    fromNativeAmount,
    fromExchangeAmount,
    toNativeAmount,
    toExchangeAmount,
    limit
  }
}

const calcSwapTo = async (
  params: {
    fromWallet: EdgeCurrencyWallet
    fromCurrencyCode: string
    toWallet: EdgeCurrencyWallet
    toCurrencyCode: string
    nativeAmount: string
    minAmount: MinAmount | undefined
    sourcePool: Pool
    destPool: Pool
    volatilitySpreadFinal: string
    affiliateFee: string
    feeInDestCurrency: string
  },
  log: Function
): Promise<{
  fromNativeAmount: string
  fromExchangeAmount: string
  toNativeAmount: string
  toExchangeAmount: string
  limit: string
}> => {
  // Get exchange rate from destination to source asset
  const {
    fromWallet,
    fromCurrencyCode,
    toWallet,
    toCurrencyCode,
    nativeAmount,
    minAmount,
    sourcePool,
    destPool,
    volatilitySpreadFinal,
    affiliateFee,
    feeInDestCurrency
  } = params
  const toNativeAmount = nativeAmount

  let toExchangeAmount = await toWallet.nativeToDenomination(
    nativeAmount,
    toCurrencyCode
  )
  log(`toExchangeAmount: ${toExchangeAmount}`)

  const limit = toFixed(mul(toExchangeAmount, THOR_LIMIT_UNITS), 0, 0)

  // Adjust the toExchangeAmount by the fee so that calcDoubleSwapInput returns a higher
  // fromAmount to compensate for the fee necessary
  const addVolatility = mul(toExchangeAmount, volatilitySpreadFinal)

  toExchangeAmount = add(toExchangeAmount, feeInDestCurrency)
  log(
    `toExchangeAmount w/network fee of ${feeInDestCurrency}: ${toExchangeAmount}`
  )
  toExchangeAmount = add(toExchangeAmount, addVolatility)
  log(
    `toExchangeAmount w/volatilitySpread ${mul(
      volatilitySpreadFinal,
      '100'
    )}%: ${toExchangeAmount}`
  )

  const result = calcDoubleSwapInput(
    Number(mul(toExchangeAmount, THOR_LIMIT_UNITS)),
    sourcePool,
    destPool
  )

  let fromExchangeAmount = div(
    result.toString(),
    THOR_LIMIT_UNITS,
    DIVIDE_PRECISION
  )
  log(`fromExchangeAmount: ${fromExchangeAmount}`)

  const addAffiliateFee = mul(fromExchangeAmount, affiliateFee)
  fromExchangeAmount = add(fromExchangeAmount, addAffiliateFee)
  log(
    `fromExchangeAmount w/affiliate fee of ${mul(
      affiliateFee,
      '100'
    )}%: ${fromExchangeAmount}`
  )

  const fromNativeAmountFloat = await fromWallet.denominationToNative(
    fromExchangeAmount,
    fromCurrencyCode
  )

  const fromNativeAmount = toFixed(fromNativeAmountFloat, 0, 0)

  // Check minimums if we can
  if (minAmount != null) {
    const { minInputAmount } = minAmount
    if (lt(fromExchangeAmount, minInputAmount)) {
      // Convert the minimum amount into an output amount
      const result = await calcSwapFrom(
        { ...params, nativeAmount: minInputAmount, dontCheckLimits: true },
        log
      )
      const toNativeAmount = toFixed(result.toNativeAmount, 0, 0)
      throw new SwapBelowLimitError(swapInfo, toNativeAmount, 'to')
    }
  }

  return {
    fromNativeAmount,
    fromExchangeAmount,
    toNativeAmount,
    toExchangeAmount,
    limit
  }
}

const buildSwapMemo = (params: BuildSwapMemoParams): string => {
  const { chain, asset, address, limit, affiliateAddress, points } = params
  // affiliate address could be a thorname, and the minimum received is not set in this example.
  return `=:${chain}.${asset}:${address}:${limit}:${affiliateAddress}:${points}`
}

const getCheckSumAddress = (assetAddress: string): string => {
  // if (assetAddress === ETHAddress) return ETHAddress
  return ethers.utils.getAddress(assetAddress.toLowerCase())
}

const getApprovalData = async (params: {
  contractAddress: string
  assetAddress: string
  publicAddress: string
  nativeAmount: string
}): Promise<string | undefined> => {
  const { contractAddress, assetAddress, publicAddress, nativeAmount } = params
  const contract = new ethers.Contract(
    assetAddress,
    erc20Abi,
    ethers.providers.getDefaultProvider()
  )

  let allowance
  try {
    allowance = await // promiseWithTimeout(
    contract.allowance(publicAddress, contractAddress)
    // )
  } catch (e) {
    // If we fail to get an allowance, just send an approval
  }

  const bnNativeAmount = ethers.BigNumber.from(nativeAmount)

  if (allowance == null || allowance.sub(bnNativeAmount).gte(0) === false) {
    try {
      const approveTx = await contract.populateTransaction.approve(
        contractAddress,
        ethers.constants.MaxUint256,
        {
          gasLimit: '500000',
          gasPrice: '20'
        }
      )
      return approveTx.data
    } catch (e) {}
  }
}

const getEvmTokenData = async (params: {
  memo: string
  // usersSendingAddress: string,
  assetAddress: string
  contractAddress: string
  vaultAddress: string
  amountToSwapWei: number
}): Promise<string> => {
  // const isETH = assetAddress === ETHAddress
  const {
    // usersSendingAddress,
    assetAddress,
    contractAddress,
    memo,
    vaultAddress,
    amountToSwapWei
  } = params

  // initialize contract
  const contract = new ethers.Contract(
    contractAddress,
    abi,
    ethers.providers.getDefaultProvider()
  )

  // Dummy gasPrice that we won't actually use
  const gasPrice = ethers.BigNumber.from('50')

  // setup contract params
  const contractParams: any[] = [
    vaultAddress,
    getCheckSumAddress(assetAddress),
    amountToSwapWei.toFixed(),
    memo,
    { gasPrice }
  ]

  // call the deposit method on the thorchain router.
  const tx = await contract.populateTransaction.deposit(...contractParams)
  if (tx.data == null) throw new Error('No data in tx object')
  return tx.data
}

//
// The below is borrowed from Thorchain docs at
// https://dev.thorchain.org/thorchain-dev/how-tos/swapping-guide
// https://gitlab.com/thorchain/asgardex-common/asgardex-util/-/blob/master/src/calc/swap.ts
//

// Calculate swap output with slippage
function calcSwapOutput(
  inputAmount: number,
  pool: Pool,
  toRune: boolean
): number {
  // formula: (inputAmount * inputBalance * outputBalance) / (inputAmount + inputBalance) ^ 2
  const inputBalance = toRune ? Number(pool.assetDepth) : Number(pool.runeDepth) // input is asset if toRune
  const outputBalance = toRune
    ? Number(pool.runeDepth)
    : Number(pool.assetDepth) // output is rune if toRune
  const numerator = inputAmount * inputBalance * outputBalance
  const denominator = Math.pow(inputAmount + inputBalance, 2)
  const result = numerator / denominator
  return result
}

export function calcSwapInput(
  outputAmount: number,
  pool: Pool,
  toRune: boolean
): number {
  // formula: (((X*Y)/y - 2*X) - sqrt(((X*Y)/y - 2*X)^2 - 4*X^2))/2
  // (part1 - sqrt(part1 - part2))/2
  const inputBalance = toRune ? Number(pool.assetDepth) : Number(pool.runeDepth) // input is asset if toRune
  const outputBalance = toRune
    ? Number(pool.runeDepth)
    : Number(pool.assetDepth) // output is rune if toRune
  const part1 = (inputBalance * outputBalance) / outputAmount - 2 * inputBalance
  const part2 = Math.pow(inputBalance, 2) * 4
  const result = (part1 - Math.sqrt(Math.pow(part1, 2) - part2)) / 2
  return result
}

// Calculate swap slippage for double swap
export function calcDoubleSwapOutput(
  inputAmount: number,
  pool1: Pool,
  pool2: Pool
): number {
  const r = calcSwapOutput(inputAmount, pool1, true)
  const result = calcSwapOutput(r, pool2, false)
  return result
}

// Calculate swap slippage for double swap
export function calcDoubleSwapInput(
  outputAmount: number,
  pool1: Pool,
  pool2: Pool
): number {
  const r = calcSwapInput(outputAmount, pool2, false)
  const result = calcSwapInput(r, pool1, true)
  return result
}

type ChainTypes =
  | 'BTC'
  | 'ETH'
  | 'BCH'
  | 'DOGE'
  | 'LTC'
  | 'AVAX'
  | 'BNB'
  | 'THOR'

const GWEI_UNITS = '1000000000'
const SAT_UNITS = '100000000'
const THOR_UNITS = SAT_UNITS
const BNB_UNITS = '10000000'

export const getGasLimit = (
  chain: ChainTypes,
  asset: string
): string | undefined => {
  if (EVM_CURRENCY_CODES[chain]) {
    if (chain === asset) {
      return EVM_SEND_GAS
    } else {
      return EVM_TOKEN_SEND_GAS
    }
  }
}

// Returns units of exchange amount
export const calcNetworkFee = (
  chain: ChainTypes,
  asset: string,
  gasRate: string,
  pools: Pool[]
): string => {
  switch (chain) {
    case 'BTC':
      return div(mul(gasRate, '1000'), SAT_UNITS, DIVIDE_PRECISION)
    case 'BCH':
      return div(mul(gasRate, '1500'), SAT_UNITS, DIVIDE_PRECISION)
    case 'LTC':
      return div(mul(gasRate, '250'), SAT_UNITS, DIVIDE_PRECISION)
    case 'DOGE':
      return div(mul(gasRate, '1000'), SAT_UNITS, DIVIDE_PRECISION)
    case 'BNB':
      return div(gasRate, BNB_UNITS, DIVIDE_PRECISION)
    case 'THOR':
      return div('2000000', THOR_UNITS, DIVIDE_PRECISION)
    case 'AVAX':
    case 'ETH':
      if (asset === chain) {
        return div(mul(gasRate, EVM_SEND_GAS), GWEI_UNITS, DIVIDE_PRECISION)
      } else {
        const ethAmount = div(
          mul(gasRate, EVM_TOKEN_SEND_GAS),
          GWEI_UNITS,
          DIVIDE_PRECISION
        )
        return convertChainAmountToAsset(pools, chain, asset, ethAmount)
      }
  }
  throw new Error(`could not calculate inbound fee for ${chain}.${asset}`)
}

const convertChainAmountToAsset = (
  pools: Pool[],
  chain: string,
  asset: string,
  amount: string
): string => {
  // Find pool of main chain
  const sourcePool = pools.find(pool => {
    return pool.asset === `${chain}.${chain}`
  })
  if (sourcePool == null) {
    throw new Error(`Cannot convert rate from ${chain} to ${asset}`)
  }

  const destPool = pools.find(pool => {
    const [poolAsset] = pool.asset.split('-')
    return poolAsset === `${chain}.${asset}`
  })
  if (destPool == null) {
    throw new Error(`Cannot convert rate from ${chain} to ${asset}`)
  }
  const sourceRate = sourcePool.assetPrice
  const destRate = destPool.assetPrice
  const out = div(mul(amount, sourceRate), destRate, DIVIDE_PRECISION)
  return out
}
