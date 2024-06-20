import { gte, lte } from 'biggystring'
import {
  asArray,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { div18 } from '../../util/biggystringplus'
import {
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  fetchInfo,
  fetchWaterfall,
  getAddress,
  hexToDecimal,
  makeQueryParams,
  promiseWithTimeout
} from '../../util/utils'
import { EdgeSwapRequestPlugin, StringMap } from '../types'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'rango',
  isDex: true,
  displayName: 'Rango Exchange',
  supportEmail: 'support@edge.app'
}

const EXPIRATION_MS = 1000 * 60
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000

const MAINNET_CODE_TRANSCRIPTION: StringMap = {
  arbitrum: 'ARBITRUM',
  avalanche: 'AVAX_CCHAIN',
  binancesmartchain: 'BSC',
  ethereum: 'ETH',
  fantom: 'FANTOM',
  moonbeam: 'MOONBEAM',
  moonriver: 'MOONRIVER',
  okexchain: 'OKC',
  optimism: 'OPTIMISM',
  polygon: 'POLYGON',
  zksync: 'ZKSYNC'
}

const RANGO_SERVERS_DEFAULT = ['https://api.rango.exchange']

const PARENT_TOKEN_CONTRACT_ADDRESS = '0x0'

const DEFAULT_SLIPPAGE = '5.0'

interface Asset {
  blockchain: string
  address: string | null
  symbol: string
}

function assetToString(asset: Asset): string {
  if (
    !(asset.address == null) &&
    asset.address !== PARENT_TOKEN_CONTRACT_ADDRESS
  )
    return `${asset.blockchain}.${asset.symbol}--${asset.address}`
  else return `${asset.blockchain}.${asset.symbol}`
}

const asInitOptions = asObject({
  appId: asOptional(asString, 'edge'),
  rangoApiKey: asString,
  referrerAddress: asOptional(asString),
  referrerFee: asOptional(asString)
})

const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      rango: asOptional(
        asObject({
          rangoServers: asOptional(asArray(asString))
        })
      )
    })
  })
})

const asCompactToken = asObject({
  // blockchain
  b: asString,
  // address
  a: asOptional(asString),
  // symbol
  s: asString
})

const asCompactMetaResponse = asObject({
  tokens: asArray(asCompactToken)
})

const asToken = asObject({
  blockchain: asString,
  address: asEither(asString, asNull),
  symbol: asString
})

const asSwapperMeta = asObject({
  id: asString,
  title: asString
})

const asSwapPath = asObject({
  from: asToken,
  to: asToken,
  swapper: asSwapperMeta,
  expectedOutput: asString
})

const asSwapFee = asObject({
  name: asString,
  token: asToken,
  expenseType: asValue(
    'FROM_SOURCE_WALLET',
    'DECREASE_FROM_OUTPUT',
    'FROM_DESTINATION_WALLET'
  ),
  amount: asString
})

const asAmountRestriction = asObject({
  min: asString,
  max: asString,
  type: asString // "EXCLUSIVE"
})

const asSwapSimulationResult = asObject({
  from: asToken,
  to: asToken,
  amountRestriction: asOptional(asAmountRestriction),
  outputAmount: asString,
  outputAmountMin: asString,
  outputAmountUsd: asEither(asNumber, asNull),
  swapper: asSwapperMeta,
  path: asEither(asArray(asSwapPath), asNull),
  fee: asArray(asSwapFee),
  feeUsd: asEither(asNumber, asNull),
  estimatedTimeInSeconds: asNumber
})

const asRoutingResultType = asValue(
  'OK',
  'HIGH_IMPACT',
  'NO_ROUTE',
  'INPUT_LIMIT_ISSUE'
)

const asEvmTransaction = asObject({
  type: asValue('EVM'),
  from: asEither(asString, asNull),
  approveTo: asEither(asString, asNull),
  approveData: asEither(asString, asNull),
  txTo: asString,
  txData: asEither(asString, asNull),
  value: asEither(asString, asNull),
  gasLimit: asEither(asString, asNull),
  gasPrice: asEither(asString, asNull),
  maxPriorityFeePerGas: asEither(asString, asNull),
  maxFeePerGas: asEither(asString, asNull)
})

const asSwapResponse = asObject({
  resultType: asRoutingResultType,
  route: asEither(asSwapSimulationResult, asNull),
  error: asEither(asString, asNull),
  tx: asEither(asEvmTransaction, asNull)
})

type ExchangeInfo = ReturnType<typeof asExchangeInfo>

type TokenSymbol = string

const rangoTokens: {
  [blockchain: string]: { [address: string]: TokenSymbol }
} = {}

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate = 0

export function makeRangoPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { appId, rangoApiKey, referrerAddress, referrerFee } = asInitOptions(
    opts.initOptions
  )

  const headers = {
    'Content-Type': 'application/json'
  }

  let rangoServers: string[] = RANGO_SERVERS_DEFAULT

  let params = makeQueryParams({
    apiKey: rangoApiKey
  })

  Object.values(MAINNET_CODE_TRANSCRIPTION).forEach(
    blockchain => (params += `&blockchains=${blockchain}`)
  )

  const metaRequest = fetchWaterfall(
    fetchCors,
    rangoServers,
    `meta/compact?${params}`,
    {
      headers
    }
  )

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const {
      fromTokenId,
      toTokenId,
      nativeAmount,
      fromWallet,
      toWallet,
      quoteFor
    } = request
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    if (Object.keys(rangoTokens).length === 0) {
      await metaRequest
        .then(async metaResponse => {
          if (metaResponse.ok) {
            return await metaResponse.json()
          } else {
            const text = await metaResponse.text()
            throw new Error(text)
          }
        })
        .then(meta => {
          const { tokens } = asCompactMetaResponse(meta)
          tokens.forEach(token => {
            const tokenBlockchain = token.b
            const tokenAddress = token.a
            const tokenSymbol = token.s
            if (rangoTokens[tokenBlockchain] === undefined) {
              rangoTokens[tokenBlockchain] = {}
            }
            rangoTokens[tokenBlockchain][
              tokenAddress ?? PARENT_TOKEN_CONTRACT_ADDRESS
            ] = tokenSymbol
          })
        })
        .catch(e => {
          throw new Error(`Error fetching Rango meta ${String(e)}`)
        })
    }

    const fromToken =
      fromTokenId != null
        ? fromWallet.currencyConfig.allTokens[fromTokenId]
        : undefined
    let fromContractAddress
    if (fromTokenId === null) {
      fromContractAddress = PARENT_TOKEN_CONTRACT_ADDRESS
    } else {
      fromContractAddress = fromToken?.networkLocation?.contractAddress
    }

    const toToken =
      toTokenId != null
        ? toWallet.currencyConfig.allTokens[toTokenId]
        : undefined
    let toContractAddress
    if (toTokenId === null) {
      toContractAddress = PARENT_TOKEN_CONTRACT_ADDRESS
    } else {
      toContractAddress = toToken?.networkLocation?.contractAddress
    }

    if (fromContractAddress == null || toContractAddress == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Do not support transfer between same assets
    if (
      fromWallet.currencyInfo.pluginId === toWallet.currencyInfo.pluginId &&
      request.fromCurrencyCode === request.toCurrencyCode
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromAddress = await getAddress(fromWallet)
    const toAddress = await getAddress(toWallet)

    const fromMainnetCode =
      MAINNET_CODE_TRANSCRIPTION[fromWallet.currencyInfo.pluginId]
    const toMainnetCode =
      MAINNET_CODE_TRANSCRIPTION[toWallet.currencyInfo.pluginId]

    if (fromMainnetCode == null || toMainnetCode == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromSymbol =
      rangoTokens[fromMainnetCode]?.[fromContractAddress.toLowerCase()]
    const toSymbol =
      rangoTokens[toMainnetCode]?.[toContractAddress.toLowerCase()]

    if (fromSymbol == null || toSymbol == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const now = Date.now()
    if (
      now - exchangeInfoLastUpdate > EXCHANGE_INFO_UPDATE_FREQ_MS ||
      exchangeInfo == null
    ) {
      try {
        const exchangeInfoResponse = await promiseWithTimeout(
          fetchInfo(fetchCors, `v1/exchangeInfo/${appId}`)
        )

        if (exchangeInfoResponse.ok === true) {
          exchangeInfo = asExchangeInfo(await exchangeInfoResponse.json())
          exchangeInfoLastUpdate = now
        } else {
          // Error is ok. We just use defaults
          const text: string = await exchangeInfoResponse.text()
          log.warn(
            `Error getting info server exchangeInfo. Using defaults... Error: ${text}`
          )
        }
      } catch (e: any) {
        log.warn(
          'Error getting info server exchangeInfo. Using defaults...',
          e.message
        )
      }
    }

    if (exchangeInfo != null) {
      const { rango } = exchangeInfo.swap.plugins
      rangoServers = rango?.rangoServers ?? rangoServers
    }

    let referrer: { referrerFee: string; referrerAddress: string } | undefined

    if (
      referrerAddress != null &&
      referrerAddress !== '' &&
      referrerFee != null &&
      referrerFee !== ''
    ) {
      referrer = { referrerAddress, referrerFee }
    }

    const swapParameters = {
      apiKey: rangoApiKey,
      from: assetToString({
        blockchain: fromMainnetCode,
        address: fromContractAddress,
        symbol: fromSymbol
      }),
      to: assetToString({
        blockchain: toMainnetCode,
        address: toContractAddress,
        symbol: toSymbol
      }),
      fromAddress: fromAddress,
      toAddress: toAddress,
      amount: nativeAmount,
      disableEstimate: true,
      slippage: DEFAULT_SLIPPAGE,
      ...(referrer != null ? referrer : undefined)
    }

    const params = makeQueryParams(swapParameters)

    const swapResponse = await fetchWaterfall(
      fetchCors,
      rangoServers,
      `basic/swap?${params}`,
      {
        headers
      }
    )

    if (!swapResponse.ok) {
      const responseText = await swapResponse.text()
      throw new Error(`Rango could not fetch quote: ${responseText}`)
    }

    const swap = asSwapResponse(await swapResponse.json())
    const { route, tx } = swap

    if (swap.resultType !== 'OK') {
      if (swap.resultType === 'INPUT_LIMIT_ISSUE') {
        const amountRestriction = swap.route?.amountRestriction
        if (amountRestriction == null) {
          throw new Error('Rango limit error without values')
        }
        const { min, max } = amountRestriction

        if (gte(nativeAmount, max)) {
          throw new SwapAboveLimitError(swapInfo, max)
        } else if (lte(nativeAmount, min)) {
          throw new SwapBelowLimitError(swapInfo, min)
        }
      }
      throw new Error(
        `Rango could not proceed with the exchange. : ${swap.resultType}`
      )
    }

    if (
      route?.path == null ||
      route.outputAmount === '' ||
      tx == null ||
      tx.txData == null
    ) {
      throw new Error('Rango could not proceed with the exchange')
    }

    const providers = route.path.map(p => p.swapper.title)

    let preTx: EdgeTransaction | undefined
    if (tx.type === 'EVM' && tx.approveData != null && tx.approveTo != null) {
      const approvalData = tx.approveData.replace('0x', '')

      const spendInfo: EdgeSpendInfo = {
        tokenId: null,
        memos: [{ type: 'hex', value: approvalData }],
        spendTargets: [
          {
            nativeAmount: '0',
            publicAddress: fromContractAddress
          }
        ],
        assetAction: {
          assetActionType: 'tokenApproval'
        },
        savedAction: {
          actionType: 'tokenApproval',
          tokenApproved: {
            pluginId: fromWallet.currencyInfo.pluginId,
            tokenId: fromTokenId,
            nativeAmount
          },
          tokenContractAddress: fromContractAddress,
          contractAddress: tx.approveTo
        }
      }
      preTx = await request.fromWallet.makeSpend(spendInfo)
    }

    const customNetworkFee = {
      gasLimit: tx.gasLimit != null ? hexToDecimal(tx.gasLimit) : undefined,
      gasPrice:
        tx.gasPrice != null ? div18(tx.gasPrice, '1000000000') : undefined,
      maxFeePerGas: tx.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? undefined
    }

    const networkFeeOption: EdgeSpendInfo['networkFeeOption'] =
      customNetworkFee.gasLimit != null || customNetworkFee.gasPrice != null
        ? 'custom'
        : undefined

    const value = tx.txData.replace('0x', '')
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      memos: [{ type: 'hex', value }],
      customNetworkFee,
      spendTargets: [
        {
          memo: tx.txData,
          nativeAmount: nativeAmount,
          publicAddress: tx.txTo
        }
      ],
      networkFeeOption,
      assetAction: {
        assetActionType: 'swap'
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        isEstimate: true,
        toAsset: {
          pluginId: toWallet.currencyInfo.pluginId,
          tokenId: toTokenId,
          nativeAmount: route.outputAmount
        },
        fromAsset: {
          pluginId: fromWallet.currencyInfo.pluginId,
          tokenId: fromTokenId,
          nativeAmount: nativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: toWallet.id,
        refundAddress: fromAddress
      }
    }

    const providersStr = providers?.join(' -> ')
    const metadataNotes = `DEX Providers: ${providersStr}`

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: nativeAmount,
      expirationDate: new Date(Date.now() + EXPIRATION_MS),
      preTx,
      metadataNotes
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      let newRequest = request
      if (request.quoteFor === 'max') {
        if (request.fromTokenId != null) {
          const maxAmount =
            request.fromWallet.balanceMap.get(request.fromTokenId) ?? '0'
          newRequest = {
            ...request,
            nativeAmount: maxAmount,
            quoteFor: 'from'
          }
        } else {
          newRequest = await getMaxSwappable(
            async r => await fetchSwapQuoteInner(r),
            request
          )
        }
      }
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}
