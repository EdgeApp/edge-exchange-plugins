// @flow

import { div, lt, mul, sub, toFixed } from 'biggystring'
import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSpendInfo,
  type EdgeSwapInfo,
  type EdgeSwapPlugin,
  type EdgeSwapQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  type InvalidCurrencyCodes,
  checkInvalidCodes,
  isLikeKind,
  makeSwapPluginQuote
} from '../../swap-helpers.js'
import {
  fetchInfo,
  fetchWaterfall,
  promiseWithTimeout
} from '../../util/utils.js'

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
const DO_CONSOLE_LOG = true
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
const EVM_SEND_GAS = '80000'
const EVM_TOKEN_SEND_GAS = '80000'
const THOR_LIMIT_UNITS = '100000000'

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

const EVM_CURRENCY_CODES = {
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
const MAINNET_CODE_TRANSCRIPTION = {
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  binancechain: 'BNB',
  litecoin: 'LTC',
  ethereum: 'ETH',
  dogecoin: 'DOGE',
  thorchain: 'RUNE'
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

const asPool = asObject({
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

const asPools = asArray(asPool)
type Pool = $Call<typeof asPool>
type ExchangeInfo = $Call<typeof asExchangeInfo>
type MinAmount = $Call<typeof asMinAmount>

let exchangeInfo: ExchangeInfo | void
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
  const clog = (...args) => (DO_CONSOLE_LOG ? log(...args) : undefined)

  const affiliateFee = div(affiliateFeeBasis, '10000', DIVIDE_PRECISION)

  const headers = {
    'Content-Type': 'application/json'
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
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

          if (exchangeInfoResponse.ok) {
            exchangeInfo = asExchangeInfo(await exchangeInfoResponse.json())
            exchangeInfoLastUpdate = now
          } else {
            // Error is ok. We just use defaults
            log('Error getting info server exchangeInfo. Using defaults...')
          }
        } catch (e) {
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
          clog(e.message)
        })
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
      let minAmount
      try {
        if (minAmountResponse == null)
          throw new Error('Failed to get minAmount')
        const responseJson = await minAmountResponse.json()
        minAmount = asMinAmount(responseJson)
      } catch (e) {
        clog('Failed to get minAmount')
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
      clog(`${fromMainnetCode}.${fromCurrencyCode} gasRate ${gasRate}`)

      const outAddressObject = inboundAddresses.find(
        addrObj => addrObj.halted === false && addrObj.chain === toMainnetCode
      )
      if (outAddressObject == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
      const { gas_rate: outboundGasRate } = outAddressObject
      clog(
        `${toMainnetCode}.${toCurrencyCode} outboundGasRate ${outboundGasRate}`
      )

      const sourcePool = pools.find(pool => {
        const [asset] = pool.asset.split('-')
        return asset === `${fromMainnetCode}.${fromCurrencyCode}`
      })
      if (sourcePool == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }
      const [sourceAsset] = sourcePool.asset.split('-')
      clog(`sourceAsset: ${sourceAsset}`)

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
      clog(`feeInDestCurrency: ${feeInDestCurrency}`)

      const assetInUsd = mul(feeInDestCurrency, destPool.assetPriceUSD)
      if (lt(assetInUsd, '1')) {
        feeInDestCurrency = div('1', destPool.assetPriceUSD, DIVIDE_PRECISION)
        clog(`feeInDestCurrency adjusted to $1 min: ${feeInDestCurrency}`)
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
          clog
        )
      } else {
        throw new Error('TODO: TO quoting')
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
        // Only know about the key 'gasPrice'
        const usesGasPrice = fromCurrencyInfo.defaultSettings.customFeeSettings.find(
          f => f === 'gasPrice'
        )
        if (usesGasPrice != null) {
          customNetworkFee = gasRate
          customNetworkFeeKey = 'gasPrice'
        }
      }

      if (customNetworkFee == null || customNetworkFeeKey == null) {
        throw new SwapCurrencyError(swapInfo, fromCurrencyCode, toCurrencyCode)
      }

      const memo = buildSwapMemo({
        chain: toMainnetCode,
        asset: toCurrencyCode,
        address: toAddress,
        limit,
        affiliateAddress: thorname,
        points: affiliateFeeBasis
      })

      const publicAddress = thorAddress

      const spendInfo: EdgeSpendInfo = {
        currencyCode: request.fromCurrencyCode,
        spendTargets: [
          {
            memo,
            nativeAmount: fromNativeAmount,
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
        tx.txid
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

type BuildSwapMemoParams = {
  chain: string,
  asset: string,
  address: string,
  limit: string,
  affiliateAddress: string,
  points: string
}

const calcSwapFrom = async (
  params: {
    fromWallet: EdgeCurrencyWallet,
    fromCurrencyCode: string,
    toWallet: EdgeCurrencyWallet,
    toCurrencyCode: string,
    nativeAmount: string,
    minAmount: MinAmount | void,
    sourcePool: Pool,
    destPool: Pool,
    volatilitySpreadFinal: string,
    affiliateFee: string,
    feeInDestCurrency: string,
    dontCheckLimits?: boolean
  },
  clog: Function
): Promise<{
  fromNativeAmount: string,
  fromExchangeAmount: string,
  toNativeAmount: string,
  toExchangeAmount: string,
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
    feeInDestCurrency
  } = params
  const fromNativeAmount = nativeAmount

  // Get exchange rate from source to destination asset
  const fromExchangeAmount = await fromWallet.nativeToDenomination(
    nativeAmount,
    fromCurrencyCode
  )

  clog(`fromExchangeAmount: ${fromExchangeAmount}`)

  // Check minimums if we can
  if (minAmount != null) {
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
  clog(`toExchangeAmount: ${toExchangeAmount}`)

  const subVolatility = mul(toExchangeAmount, volatilitySpreadFinal)
  const subAffiliateFee = mul(toExchangeAmount, affiliateFee)

  toExchangeAmount = sub(toExchangeAmount, subVolatility)
  clog(
    `toExchangeAmount w/volatilitySpread of ${mul(
      volatilitySpreadFinal,
      '100'
    )}%: ${toExchangeAmount}`
  )
  toExchangeAmount = sub(toExchangeAmount, subAffiliateFee)
  clog(
    `toExchangeAmount w/affiliate fee of ${mul(
      affiliateFee,
      '100'
    )}%: ${toExchangeAmount}`
  )
  toExchangeAmount = sub(toExchangeAmount, feeInDestCurrency)
  clog(
    `toExchangeAmount w/network fee of ${feeInDestCurrency}: ${toExchangeAmount}`
  )

  const toNativeAmount = await toWallet.denominationToNative(
    toExchangeAmount,
    toCurrencyCode
  )
  clog(`toNativeAmount: ${toNativeAmount}`)
  const limit = toFixed(mul(toExchangeAmount, THOR_LIMIT_UNITS), 0, 0)
  clog(`limit: ${limit}`)

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
): string | void => {
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
