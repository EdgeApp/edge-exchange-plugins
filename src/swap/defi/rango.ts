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
import { WEI_MULTIPLIER } from './defiUtils'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'rango',
  isDex: true,
  displayName: 'Rango Exchange',
  supportEmail: 'support@edge.app'
}
const orderUri = 'https://explorer.rango.exchange/search?query='

const EXPIRATION_MS = 1000 * 60
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000

const MAINNET_CODE_TRANSCRIPTION: StringMap = {
  arbitrum: 'ARBITRUM',
  // axelar: 'AXELAR',
  avalanche: 'AVAX_CCHAIN',
  base: 'BASE',
  binancesmartchain: 'BSC',
  // bitcoin: 'BTC',
  // celo: 'CELO',
  // cosmoshub: 'COSMOS',
  // dash: 'DASH',
  // dogecoin: 'DOGE',
  ethereum: 'ETH',
  fantom: 'FANTOM',
  // injective: 'INJECTIVE',
  // litecoin: 'LTC',
  // maya: 'MAYA',
  // moonbeam: 'MOONBEAM',
  // moonriver: 'MOONRIVER',
  // okexchain: 'OKC',
  optimism: 'OPTIMISM',
  // osmosis: 'OSMOSIS',
  polygon: 'POLYGON',
  // thorchainrune: 'THOR',
  // solana: 'SOLANA',
  // tron: 'TRON',
  zksync: 'ZKSYNC',
  solana: 'SOLANA',
  sonic: 'SONIC'
}

const RANGO_SERVERS_DEFAULT = ['https://api.rango.exchange']

const PARENT_TOKEN_CONTRACT_ADDRESS = '0x0'

const DEFAULT_SLIPPAGE = '5.0'

interface Asset {
  blockchain: string
  address: string
}

export function assetToString(asset: Asset): string {
  return `${asset.blockchain}${
    asset.address === PARENT_TOKEN_CONTRACT_ADDRESS ? '' : '--' + asset.address
  }`
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

const asSolanaTransaction = asObject({
  type: asValue('SOLANA'),
  serializedMessage: asEither(asArray(asNumber), asNull)
})

const asSwapResponse = asObject({
  resultType: asRoutingResultType,
  route: asEither(asSwapSimulationResult, asNull),
  error: asEither(asString, asNull),
  tx: asEither(asEvmTransaction, asSolanaTransaction, asNull)
})

type ExchangeInfo = ReturnType<typeof asExchangeInfo>

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
        address: fromContractAddress
      }),
      to: assetToString({
        blockchain: toMainnetCode,
        address: toContractAddress
      }),
      fromAddress: fromAddress,
      toAddress: toAddress,
      amount: nativeAmount,
      disableEstimate: true,
      avoidNativeFee: true,
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
      if (
        swap.resultType === 'INPUT_LIMIT_ISSUE' ||
        (swap.error?.includes('Your input amount might be too low!') ?? false)
      ) {
        const amountRestriction = swap.route?.amountRestriction
        const fromTo = request.quoteFor === 'to' ? 'to' : 'from'

        if (amountRestriction == null) {
          // Assume null amountRestrictions means below limit
          throw new SwapBelowLimitError(swapInfo, undefined, fromTo)
        }
        const { min, max } = amountRestriction

        if (gte(nativeAmount, max)) {
          throw new SwapAboveLimitError(swapInfo, max, fromTo)
        } else if (lte(nativeAmount, min)) {
          throw new SwapBelowLimitError(swapInfo, min, fromTo)
        }
      }
      throw new Error(
        `Rango could not proceed with the exchange. : ${swap.resultType}`
      )
    }

    if (route?.path == null || route.outputAmount === '' || tx == null) {
      throw new Error('Rango could not proceed with the exchange')
    }

    const providers = route.path.map(p => p.swapper.title)

    let preTx: EdgeTransaction | undefined
    let spendInfo: EdgeSpendInfo

    switch (tx.type) {
      case 'SOLANA': {
        const solanaTransaction = asSolanaTransaction(tx)
        if (solanaTransaction.serializedMessage === null) {
          throw new SwapCurrencyError(swapInfo, request)
        }
        const SOLANA_PARENT_TOKEN_PROGRAM_ID =
          '11111111111111111111111111111111'

        spendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount,
              publicAddress:
                fromContractAddress === PARENT_TOKEN_CONTRACT_ADDRESS
                  ? SOLANA_PARENT_TOKEN_PROGRAM_ID
                  : fromContractAddress
            }
          ],
          otherParams: {
            unsignedTx: Buffer.from(
              solanaTransaction.serializedMessage
            ).toString('base64')
          },
          memos: [],
          networkFeeOption: 'high',
          assetAction: {
            assetActionType: 'swap'
          },
          savedAction: {
            actionType: 'swap',
            swapInfo,
            orderUri: `${orderUri}${toAddress}`,
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

        break
      }

      default: {
        const evmTransaction = asEvmTransaction(tx)
        if (evmTransaction.txData == null) {
          throw new Error('Rango could not proceed with the exchange')
        }
        const { approveData, approveTo } = evmTransaction
        if (approveData != null && approveTo != null) {
          const approvalData = approveData.replace('0x', '')

          spendInfo = {
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
              contractAddress: approveTo
            }
          }
          preTx = await request.fromWallet.makeSpend(spendInfo)
        }
        const customNetworkFee = {
          gasLimit:
            evmTransaction.gasLimit != null
              ? hexToDecimal(evmTransaction.gasLimit)
              : undefined,
          gasPrice:
            evmTransaction.gasPrice != null
              ? div18(evmTransaction.gasPrice, WEI_MULTIPLIER)
              : undefined,
          maxFeePerGas: evmTransaction.maxFeePerGas ?? undefined,
          maxPriorityFeePerGas: evmTransaction.maxPriorityFeePerGas ?? undefined
        }

        const networkFeeOption: EdgeSpendInfo['networkFeeOption'] =
          customNetworkFee.gasLimit != null || customNetworkFee.gasPrice != null
            ? 'custom'
            : 'high'

        const value = evmTransaction.txData.replace('0x', '')
        spendInfo = {
          tokenId: request.fromTokenId,
          memos: [{ type: 'hex', value }],
          customNetworkFee,
          spendTargets: [
            {
              memo: evmTransaction.txData,
              nativeAmount: nativeAmount,
              publicAddress: evmTransaction.txTo
            }
          ],
          networkFeeOption,
          assetAction: {
            assetActionType: 'swap'
          },
          savedAction: {
            actionType: 'swap',
            swapInfo,
            orderUri: `${orderUri}${toAddress}`,
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
      }
    }

    const providersStr = providers?.join(' -> ')
    const metadataNotes = `DEX Providers: ${providersStr}`

    return {
      expirationDate: new Date(Date.now() + EXPIRATION_MS),
      fromNativeAmount: nativeAmount,
      metadataNotes,
      minReceiveAmount: route.outputAmountMin,
      preTx,
      request,
      spendInfo,
      swapInfo
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
