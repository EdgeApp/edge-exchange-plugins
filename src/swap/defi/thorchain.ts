import { add, div, gt, lt, mul, sub, toFixed } from 'biggystring'
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
import {
  convertRequest,
  fetchInfo,
  fetchWaterfall,
  promiseWithTimeout
} from '../../util/utils'
import abi from './abi/THORCHAIN_SWAP_ABI'
import erc20Abi from './abi/UNISWAP_V2_ERC20_ABI'

const pluginId = 'thorchain'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Thorchain',
  supportEmail: 'support@edge.app'
}

const asInitOptions = asObject({
  affiliateFeeBasis: asOptional(asString, '50'),
  thorname: asOptional(asString, 'ej')
})

export const MIDGARD_SERVERS_DEFAULT = ['https://midgard.thorchain.info']
export const EXPIRATION_MS = 1000 * 60
export const DIVIDE_PRECISION = 16
export const VOLATILITY_SPREAD_DEFAULT = 0.01
export const LIKE_KIND_VOLATILITY_SPREAD_DEFAULT = 0.0025
export const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
export const EVM_SEND_GAS = '80000'
export const EVM_TOKEN_SEND_GAS = '80000'
export const MIN_USD_SWAP = '30'
export const THOR_LIMIT_UNITS = '100000000'

export const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

export const EVM_CURRENCY_CODES: { [cc: string]: boolean } = {
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
export const MAINNET_CODE_TRANSCRIPTION: { [cc: string]: ChainTypes } = {
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

export const asInboundAddresses = asArray(
  asObject({
    address: asString,
    chain: asString,
    outbound_fee: asString,
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

export const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      thorchain: asObject({
        volatilitySpread: asNumber,
        likeKindVolatilitySpread: asNumber,
        daVolatilitySpread: asNumber,
        midgardServers: asArray(asString),
        nineRealmsServers: asOptional(asArray(asString)),
        thorSwapServers: asOptional(asArray(asString))
      })
    })
  })
})

const asPools = asArray(asPool)

type Pool = ReturnType<typeof asPool>
type ExchangeInfo = ReturnType<typeof asExchangeInfo>
type MinAmount = ReturnType<typeof asMinAmount>

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0

export function makeThorchainPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetch } = io
  const { thorname, affiliateFeeBasis } = asInitOptions(opts.initOptions)
  const affiliateFee = div(affiliateFeeBasis, '10000', DIVIDE_PRECISION)

  const headers = {
    'Content-Type': 'application/json'
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)
      const {
        fromCurrencyCode,
        toCurrencyCode,
        nativeAmount,
        fromWallet,
        toWallet,
        quoteFor
      } = request
      // Do not support transfer between same assets
      if (
        fromWallet.currencyInfo.pluginId === toWallet.currencyInfo.pluginId &&
        request.fromCurrencyCode === request.toCurrencyCode
      ) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
      const likeKind = isLikeKind(fromCurrencyCode, toCurrencyCode)

      let midgardServers: string[] = MIDGARD_SERVERS_DEFAULT
      let likeKindVolatilitySpread: number = LIKE_KIND_VOLATILITY_SPREAD_DEFAULT
      let volatilitySpread: number = VOLATILITY_SPREAD_DEFAULT

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      // Grab addresses:
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
      }

      const volatilitySpreadFinal = likeKind
        ? likeKindVolatilitySpread.toString()
        : volatilitySpread.toString()

      // Get current pool
      const [iaResponse, poolResponse] = await Promise.all([
        fetchWaterfall(
          fetch,
          midgardServers,
          'v2/thorchain/inbound_addresses',
          {
            headers
          }
        ),
        fetchWaterfall(fetch, midgardServers, 'v2/pools', { headers })
      ])

      if (!iaResponse.ok) {
        const responseText = await iaResponse.text()
        throw new Error(
          `Thorchain could not fetch inbound_addresses: ${responseText}`
        )
      }
      if (!poolResponse.ok) {
        const responseText = await poolResponse.text()
        throw new Error(`Thorchain could not fetch pools: ${responseText}`)
      }

      // Nine realms servers removed minAmount support so disable for now but keep all code
      // logic so we can easily enable in the future with new API
      const minAmount = undefined

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
      const { address: thorAddress } = inAddressObject

      const outAddressObject = inboundAddresses.find(
        addrObj => !addrObj.halted && addrObj.chain === toMainnetCode
      )
      if (outAddressObject == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
      const { outbound_fee: outAssetOutboundFee } = outAddressObject
      log(
        `${toMainnetCode}.${toCurrencyCode} outAssetOutboundFee ${outAssetOutboundFee}`
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
      const feeInDestCurrency = calcNetworkFee(
        toMainnetCode,
        toCurrencyCode,
        outAssetOutboundFee,
        pools
      )
      log(`feeInDestCurrency: ${feeInDestCurrency}`)

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
  let fromExchangeAmount = await fromWallet.nativeToDenomination(
    nativeAmount,
    fromCurrencyCode
  )

  log(`fromExchangeAmount: ${fromExchangeAmount}`)

  // Check minimums if we can
  if (!dontCheckLimits) {
    const srcInUsd = mul(sourcePool.assetPriceUSD, fromExchangeAmount)
    let fromMinNativeAmount
    if (lt(srcInUsd, MIN_USD_SWAP)) {
      const minExchangeAmount = div(
        MIN_USD_SWAP,
        sourcePool.assetPriceUSD,
        DIVIDE_PRECISION
      )
      fromMinNativeAmount = await fromWallet.denominationToNative(
        minExchangeAmount,
        fromCurrencyCode
      )
    }

    if (minAmount != null && lt(fromExchangeAmount, minAmount.minInputAmount)) {
      const tempNativeMin = await fromWallet.denominationToNative(
        minAmount.minInputAmount,
        fromCurrencyCode
      )
      if (gt(tempNativeMin, fromMinNativeAmount ?? '0')) {
        fromMinNativeAmount = tempNativeMin
      }
    }
    if (fromMinNativeAmount != null) {
      throw new SwapBelowLimitError(swapInfo, fromMinNativeAmount, 'from')
    }
  }

  // Calc the total % fees including affiliate and volatility
  const totalFeePercent = add(volatilitySpreadFinal, affiliateFee)
  log(`totalFeePercent: ${totalFeePercent}`)
  fromExchangeAmount = mul(sub('1', totalFeePercent), fromExchangeAmount)
  log(`fromExchangeAmount after % fees: ${fromExchangeAmount}`)

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

  toExchangeAmount = add(toExchangeAmount, feeInDestCurrency)
  log(
    `toExchangeAmount w/network fee of ${feeInDestCurrency}: ${toExchangeAmount}`
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

  // Calc the total % fees including affiliate and volatility
  const totalFeePercent = add(volatilitySpreadFinal, affiliateFee)
  log(`totalFeePercent: ${totalFeePercent}`)
  const invPercent = sub('1', totalFeePercent)

  fromExchangeAmount = div(fromExchangeAmount, invPercent, 32)
  log(`fromExchangeAmount after % fees: ${fromExchangeAmount}`)

  const fromNativeAmountFloat = await fromWallet.denominationToNative(
    fromExchangeAmount,
    fromCurrencyCode
  )

  const fromNativeAmount = toFixed(fromNativeAmountFloat, 0, 0)

  const srcInUsd = mul(sourcePool.assetPriceUSD, fromExchangeAmount)
  let minExchangeAmount = '0'
  if (lt(srcInUsd, MIN_USD_SWAP)) {
    minExchangeAmount = div(
      MIN_USD_SWAP,
      sourcePool.assetPriceUSD,
      DIVIDE_PRECISION
    )
  }

  // Check minimums
  const { minInputAmount } = minAmount ?? { minInputAmount: '0' }
  if (gt(minInputAmount, minExchangeAmount)) {
    minExchangeAmount = minInputAmount
  }

  if (lt(fromExchangeAmount, minExchangeAmount)) {
    const fromMinNativeAmount = await fromWallet.denominationToNative(
      minExchangeAmount,
      fromCurrencyCode
    )

    // Convert the minimum amount into an output amount
    const result = await calcSwapFrom(
      { ...params, nativeAmount: fromMinNativeAmount, dontCheckLimits: true },
      log
    )
    const toNativeAmount = toFixed(result.toNativeAmount, 0, 0)

    // Add one native amount unit due to biggystring rounding down all divisions
    throw new SwapBelowLimitError(swapInfo, add(toNativeAmount, '1'), 'to')
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

export const getApprovalData = async (params: {
  contractAddress: string
  assetAddress: string
  nativeAmount: string
}): Promise<string | undefined> => {
  const { contractAddress, assetAddress, nativeAmount } = params
  const contract = new ethers.Contract(
    assetAddress,
    erc20Abi,
    ethers.providers.getDefaultProvider()
  )

  const bnNativeAmount = ethers.BigNumber.from(nativeAmount)
  const approveTx = await contract.populateTransaction.approve(
    contractAddress,
    bnNativeAmount,
    {
      gasLimit: '500000',
      gasPrice: '20'
    }
  )
  return approveTx.data
}

export const getEvmTokenData = async (params: {
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

const SAT_UNITS = '100000000'
const THOR_UNITS = SAT_UNITS

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
  outboundFee: string,
  pools: Pool[]
): string => {
  switch (chain) {
    case 'BTC':
    case 'BCH':
    case 'LTC':
    case 'DOGE':
    case 'BNB':
      return div(outboundFee, THOR_UNITS, DIVIDE_PRECISION)
    case 'THOR':
      return div('2000000', THOR_UNITS, DIVIDE_PRECISION)
    case 'AVAX':
    case 'ETH':
      if (asset === chain) {
        return div(outboundFee, THOR_UNITS, DIVIDE_PRECISION)
      } else {
        const ethAmount = div(outboundFee, THOR_UNITS, DIVIDE_PRECISION)
        return convertChainAmountToAsset(pools, chain, asset, ethAmount)
      }
    default:
      throw new Error(
        `could not calculate inbound fee for ${String(chain)}.${asset}`
      )
  }
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
