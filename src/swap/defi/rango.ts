import { div, gte, lte, mul, round, sub } from 'biggystring'
import {
  asArray,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown,
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
  fetchRatesV3,
  fetchWaterfall,
  findMinimumSwapAmount,
  getAddress,
  hexToDecimal,
  makeQueryParams,
  promiseWithTimeout
} from '../../util/utils'
import {
  asV3RatesParams,
  EdgeSwapRequestPlugin,
  MakeTxParams,
  StringMap
} from '../types'
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
  axelar: 'AXELAR', // "Supported," but unable to find actual routes at this time
  avalanche: 'AVAX_CCHAIN',
  base: 'BASE',
  binancesmartchain: 'BSC',
  bitcoin: 'BTC', // Pending "from" support. Enabled only to allow "to" swaps.
  celo: 'CELO', // May not have any valid single step routes at this time
  cosmoshub: 'COSMOS',
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
  osmosis: 'OSMOSIS',
  polygon: 'POLYGON',
  solana: 'SOLANA',
  thorchainrune: 'THOR',
  // tron: 'TRON', // Currently only centralized bridges available, so won't return a quote.
  zksync: 'ZKSYNC'
}

const RANGO_SERVERS_DEFAULT = ['https://api.rango.exchange']

const PARENT_TOKEN_CONTRACT_ADDRESS = '0x0'

const DEFAULT_SLIPPAGE = '5'

interface Asset {
  blockchain: string
  address: string
}

const createAssetString = (
  mainnetCode: string,
  contractAddress: string,
  currencyCode: string
): string => {
  if (['COSMOS', 'OSMOSIS', 'THOR', 'AXELAR'].includes(mainnetCode)) {
    // For Cosmos chains, Rango expects BLOCKCHAIN.SYMBOL format
    if (contractAddress === PARENT_TOKEN_CONTRACT_ADDRESS) {
      // Native tokens: BLOCKCHAIN.SYMBOL (e.g., COSMOS.ATOM, OSMOSIS.OSMO)
      return `${mainnetCode}.${currencyCode}`
    } else {
      // Contract tokens: BLOCKCHAIN.SYMBOL--address (e.g., OSMOSIS.ATOM--ibc/123...)
      return `${mainnetCode}.${currencyCode}--${contractAddress}`
    }
  }
  // For all other chains, use the standard blockchain/blockchain--address format
  return assetToString({
    blockchain: mainnetCode,
    address: contractAddress
  })
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
  // from: asEither(asString, asNull), // Unused
  approveTo: asEither(asString, asNull),
  approveData: asEither(asString, asNull),
  txTo: asString,
  txData: asEither(asString, asNull),
  // value: asEither(asString, asNull), // Unused
  gasLimit: asEither(asString, asNull),
  gasPrice: asEither(asString, asNull),
  maxPriorityFeePerGas: asEither(asString, asNull),
  maxFeePerGas: asEither(asString, asNull)
})

const asSolanaTransaction = asObject({
  type: asValue('SOLANA'),
  serializedMessage: asEither(asArray(asNumber), asNull)
})

const asCosmosTransaction = asObject({
  type: asValue('COSMOS'),
  // fromWalletAddress: asEither(asString, asNull), // Unused
  // blockChain: asEither(asString, asNull), // Unused
  // Preserve provider payload as-is; parsed downstream in core
  data: asOptional(asUnknown)
  // rawTransfer: asEither(asString, asNull), // Unused
  // expectedOutput: asOptional(asString) // Unused
})

const asTronPayload = asObject({
  // owner_address: asString, // Unused
  // call_value: asNumber, // Unused
  contract_address: asOptional(asString),
  // fee_limit: asNumber, // Unused
  // function_selector: asString, // Unused
  parameter: asString
  // chainType: asEither(asString, asNull) // Unused
})

const asTronTransaction = asObject({
  type: asValue('TRON'),
  // raw_data: asOptional(asUnknown), // Unused
  // approve_raw_data: asOptional(asUnknown), // Unused
  // raw_data_hex: asEither(asString, asNull), // Unused
  // approve_raw_data_hex: asEither(asString, asNull), // Unused
  __payload__: asOptional(asTronPayload),
  approve_payload: asOptional(asTronPayload)
  // txID: asEither(asString, asNull), // Unused
  // approveTxID: asEither(asString, asNull), // Unused
  // visible: asOptional(asUnknown), // Unused
  // approveVisible: asOptional(asUnknown) // Unused
})

const asUtxoTransaction = asObject({
  // Rango may return type like 'TRANSFER' (schema is not strictly documented)
  type: asString,
  // Common address fields observed across providers
  toAddress: asOptional(asString),
  recipientAddress: asOptional(asString),
  inboundAddress: asOptional(asString),
  destination: asOptional(asString),
  // Memo can be ascii or hex depending on provider
  memo: asOptional(asString),
  memoHex: asOptional(asString),
  opReturn: asOptional(asString)
})

const asSwapResponse = asObject({
  resultType: asRoutingResultType,
  route: asEither(asSwapSimulationResult, asNull),
  error: asEither(asString, asNull),
  tx: asEither(
    asEvmTransaction,
    asSolanaTransaction,
    asCosmosTransaction,
    asTronTransaction,
    asUtxoTransaction,
    asNull
  ),
  // Common tracking fields that might be in the response
  requestId: asOptional(asString),
  id: asOptional(asString),
  uuid: asOptional(asString),
  transactionId: asOptional(asString)
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
          const json = await exchangeInfoResponse.json()
          exchangeInfo = asExchangeInfo(json)
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
      referrer = { referrerAddress: referrerAddress.toLowerCase(), referrerFee }
    }

    const isFromUtxo = ['BTC', 'LTC', 'DASH', 'DOGE'].includes(fromMainnetCode)
    const swapParameters = {
      apiKey: rangoApiKey,
      from: createAssetString(
        fromMainnetCode,
        fromContractAddress,
        request.fromCurrencyCode
      ),
      to: createAssetString(
        toMainnetCode,
        toContractAddress,
        request.toCurrencyCode
      ),
      fromAddress,
      toAddress,
      amount: nativeAmount,
      disableEstimate: true,
      // For UTXO flows, allow native fee usage (ThorChain requires on-chain fee)
      avoidNativeFee: !isFromUtxo,
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

    const swapResponseJson = await swapResponse.json()
    log(`Rango swap response:`, swapResponseJson)
    const swap = asSwapResponse(swapResponseJson)
    const { route, tx } = swap

    if (swap.resultType !== 'OK') {
      // Try to handle failed result
      if (
        swap.resultType === 'NO_ROUTE' || // TODO: https://api-docs.rango.exchange/reference/getbestroutes - Integrate "diagnosisMessages" instead?
        swap.resultType === 'INPUT_LIMIT_ISSUE' ||
        (swap.error?.includes('Your input amount might be too low!') ?? false)
      ) {
        const amountRestriction = swap.route?.amountRestriction
        const fromTo = request.quoteFor === 'to' ? 'to' : 'from'

        if (amountRestriction == null) {
          // Try to find the actual minimum using binary search
          log(
            `Amount appears too low (${
              swap.error ?? 'unknown error'
            }), attempting binary search for minimum`
          )

          // For Rango, we're always searching for minimum 'from' amount since it only supports 'from' quotes
          const searchWallet = fromWallet
          const searchTokenId = request.fromTokenId

          // Create a quote tester function that varies the from amount
          const quoteTester = async (
            testNativeAmount: string
          ): Promise<boolean> => {
            try {
              const testSwapParameters = {
                ...swapParameters,
                amount: testNativeAmount
              }
              const testParams = makeQueryParams(testSwapParameters)
              const testResponse = await fetchWaterfall(
                fetchCors,
                rangoServers,
                `basic/swap?${testParams}`,
                { headers }
              )

              if (testResponse.ok) {
                const testJson = await testResponse.json()
                const testSwap = asSwapResponse(testJson)
                return testSwap.resultType === 'OK'
              }
              return false
            } catch (e) {
              return false
            }
          }

          // Seed the search at ~$300 USD equivalent in native units when possible
          let startingNativeAmount: string | undefined
          try {
            // Determine multiplier for native units
            const { currencyInfo } = searchWallet
            let multiplier: string
            if (searchTokenId == null) {
              multiplier = currencyInfo.denominations[0].multiplier
            } else {
              const token = searchWallet.currencyConfig.allTokens[searchTokenId]
              if (token == null) throw new Error('token not found')
              multiplier = token.denominations[0].multiplier
            }

            // Determine currency code for rate lookup
            const searchCurrencyCode =
              searchTokenId == null
                ? searchWallet.currencyInfo.currencyCode
                : searchWallet.currencyConfig.allTokens[searchTokenId]
                    ?.currencyCode

            if (searchCurrencyCode != null) {
              let exchangeRate: string | undefined
              try {
                const v3Body = {
                  targetFiat: 'USD',
                  crypto: [
                    {
                      isoDate: new Date().toISOString(),
                      asset: {
                        pluginId: searchWallet.currencyInfo.pluginId,
                        tokenId: searchTokenId
                      }
                    }
                  ],
                  fiat: []
                }
                const v3Response = await fetchRatesV3(fetchCors, 'v3/rates', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(v3Body)
                })
                if (v3Response.ok) {
                  const v3Json = await v3Response.json()
                  const v3 = asV3RatesParams(v3Json)
                  const v3Rate = v3.crypto?.[0]?.rate
                  if (v3Rate != null) exchangeRate = v3Rate.toString()
                }
              } catch (e) {
                log.warn(
                  'rango: Error getting exchange rate for minimum lookup: ',
                  JSON.stringify(e)
                )
              }

              if (exchangeRate != null && exchangeRate !== '0') {
                const startingExchangeAmount = div('300', exchangeRate, 20)
                startingNativeAmount = round(
                  mul(startingExchangeAmount, multiplier),
                  0
                )
              }
            }
          } catch (e) {
            log.warn(
              'rango: Error during swap minimum binary search: ',
              JSON.stringify(e)
            )
          }

          // Find minimum using exponential + binary search in native units
          const foundMinimum: string | undefined =
            startingNativeAmount == null
              ? undefined
              : await findMinimumSwapAmount({
                  startingNativeAmount,
                  quoteTester
                })

          if (foundMinimum != null) {
            throw new SwapBelowLimitError(swapInfo, foundMinimum, fromTo)
          }

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
        `Rango could not proceed with the exchange: ${swap.resultType} ${
          swap.error ?? ''
        }`
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

      case 'COSMOS': {
        const cosmosTransaction = asCosmosTransaction(tx)
        log(`COSMOS transaction:`, cosmosTransaction)
        if (cosmosTransaction.data == null) {
          throw new SwapCurrencyError(swapInfo, request)
        }

        // Use requestId/id/uuid/transactionId for tracking if available
        const trackingId =
          swap.requestId ?? swap.id ?? swap.uuid ?? swap.transactionId ?? ''
        const trackingUri =
          trackingId !== ''
            ? `${orderUri}${trackingId}`
            : `${orderUri}${toAddress}`
        log(`Rango tracking: id=${trackingId}, uri=${trackingUri}`)

        // Create the saved action for the swap
        const savedAction = {
          actionType: 'swap' as const,
          swapInfo,
          orderUri: trackingUri,
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

        // Create makeTxParams for COSMOS swap
        const makeTxParams: MakeTxParams = {
          type: 'MakeTxDexSwap' as const,
          assetAction: { assetActionType: 'swap' as const },
          savedAction,
          fromTokenId: request.fromTokenId,
          fromNativeAmount: nativeAmount,
          toTokenId: request.toTokenId,
          toNativeAmount: route.outputAmount,
          txData: JSON.stringify(cosmosTransaction.data)
        }

        const providersStr = providers?.join(' -> ')
        const metadataNotes = `DEX Providers: ${providersStr}`

        // Return SwapOrder with makeTxParams directly (not spendInfo)
        return {
          expirationDate: new Date(Date.now() + EXPIRATION_MS),
          fromNativeAmount: nativeAmount,
          metadataNotes,
          minReceiveAmount: route.outputAmountMin,
          preTx,
          request,
          makeTxParams,
          swapInfo
        }
      }

      // Handle UTXO-style transfers (BTC/LTC/DASH/DOGE)
      case 'TRANSFER': {
        const utxoTx = asUtxoTransaction(tx)

        // Choose the best available destination field
        const depositAddress =
          utxoTx.recipientAddress ??
          utxoTx.toAddress ??
          utxoTx.inboundAddress ??
          utxoTx.destination
        if (depositAddress == null) {
          throw new SwapCurrencyError(swapInfo, request)
        }

        // Memo can be ascii or hex
        const memos: EdgeSpendInfo['memos'] = []
        if (utxoTx.memoHex != null && utxoTx.memoHex !== '') {
          memos.push({ type: 'hex', value: utxoTx.memoHex })
        } else if (utxoTx.opReturn != null && utxoTx.opReturn !== '') {
          memos.push({ type: 'hex', value: utxoTx.opReturn })
        } else if (utxoTx.memo != null && utxoTx.memo !== '') {
          memos.push({ type: 'text', value: utxoTx.memo })
        }

        spendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount,
              publicAddress: depositAddress
            }
          ],
          memos,
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

      // Untested and disabled at this time.
      case 'TRON': {
        const tronTransaction = asTronTransaction(tx)
        if (tronTransaction.__payload__ == null) {
          throw new SwapCurrencyError(swapInfo, request)
        }

        const payload = tronTransaction.__payload__

        // Check if there's an approval transaction needed
        if (tronTransaction.approve_payload != null) {
          const approvePayload = tronTransaction.approve_payload
          const approvalSpendInfo = {
            tokenId: null,
            spendTargets: [
              {
                nativeAmount: '0',
                publicAddress: fromContractAddress,
                otherParams: {
                  data: approvePayload.parameter
                }
              }
            ],
            assetAction: {
              assetActionType: 'tokenApproval'
            } as const,
            savedAction: {
              actionType: 'tokenApproval' as const,
              tokenApproved: {
                pluginId: fromWallet.currencyInfo.pluginId,
                tokenId: fromTokenId,
                nativeAmount
              },
              tokenContractAddress: fromContractAddress,
              contractAddress: payload.contract_address ?? fromContractAddress
            }
          }
          preTx = await request.fromWallet.makeSpend(approvalSpendInfo)
        }

        spendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount,
              publicAddress: toAddress,
              otherParams: {
                data: payload.parameter
              }
            }
          ],
          networkFeeOption: 'high',
          assetAction: {
            assetActionType: 'swap'
          } as const,
          savedAction: {
            actionType: 'swap' as const,
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
          // Native-asset max: probe with full balance, then subtract on-chain fee if available
          const balance = request.fromWallet.balanceMap.get(null) ?? '0'
          const probeRequest = {
            ...request,
            nativeAmount: balance,
            quoteFor: 'from' as const
          }
          try {
            const probeOrder = await fetchSwapQuoteInner(probeRequest)
            if ('makeTxParams' in probeOrder) {
              const txData = (probeOrder as any).makeTxParams?.txData
              if (typeof txData === 'string' && txData.length > 0) {
                try {
                  const data = JSON.parse(txData)
                  const feeAmt: string | undefined =
                    data?.fee?.amount?.[0]?.amount
                  if (feeAmt != null) {
                    const maxAmount = sub(balance, feeAmt)
                    newRequest = {
                      ...request,
                      nativeAmount: maxAmount,
                      quoteFor: 'from'
                    }
                  } else {
                    newRequest = probeRequest
                  }
                } catch {
                  newRequest = probeRequest
                }
              } else {
                newRequest = probeRequest
              }
            } else {
              // For spendInfo-based paths, use generic helper
              newRequest = await getMaxSwappable(
                async r => await fetchSwapQuoteInner(r),
                request
              )
            }
          } catch {
            newRequest = probeRequest
          }
        }
      }
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      const quote = await makeSwapPluginQuote(swapOrder)
      return quote
    }
  }
  return out
}
