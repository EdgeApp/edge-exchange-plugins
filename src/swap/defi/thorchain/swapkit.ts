import { gt, toFixed } from 'biggystring'
import {
  asArray,
  asEither,
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../../util/swapHelpers'
import {
  convertRequest,
  fetchInfo,
  fetchWaterfall,
  getAddress,
  promiseWithTimeout
} from '../../../util/utils'
import { EdgeSwapRequestPlugin } from '../../types'
import { createEvmApprovalEdgeTransactions } from '../defiUtils'
import { MAINNET_CODE_TRANSCRIPTION } from './thorchain'
import {
  AFFILIATE_FEE_BASIS_DEFAULT,
  EVM_CURRENCY_CODES,
  EXCHANGE_INFO_UPDATE_FREQ_MS,
  EXPIRATION_MS,
  getGasLimit,
  INVALID_CURRENCY_CODES
} from './thorchainCommon'

const pluginId = 'swapkit'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: true,
  displayName: 'SwapKit',
  supportEmail: 'support@edge.app'
}

// This needs to be a type so adding the '& {}' prevents auto correction to an interface
type ThorSwapQuoteParams = {
  sellAsset: string
  buyAsset: string
  sellAmount: string
  slippage: number
  sourceAddress: string
  destinationAddress: string
  affiliate: string
  affiliateFee: number
  referer?: string
  includeTx: boolean
} & {}

const asEvmCleaner = asObject({
  // to: asString,
  // from: asString,
  // gas: asString,
  // gasPrice: asString,
  // value: asString,
  data: asString
})

const asCosmosCleaner = asObject({
  memo: asString,
  accountNumber: asNumber,
  sequence: asNumber,
  chainId: asString,
  msgs: asArray(asObject({ typeUrl: asString, value: asUnknown })),
  fee: asObject({
    amount: asArray(
      asObject({
        denom: asString,
        amount: asString
      })
    ),
    gas: asString
  })
})

const asThorSwapRoute = asObject({
  // buyAsset: asString,
  // destinationAddress: asString,
  expectedBuyAmount: asString,
  // expectedBuyAmountMaxSlippage: asString,
  // fees,
  // legs,
  meta: asObject({
    approvalAddress: asOptional(asString)
  }),
  providers: asArray(asString),
  // sellAsset: asString,
  // sellAmount: asString,
  // sourceAddress: asString,
  // totalSlippageBps: asNumber,
  // warnings,
  // estimatedTime,
  expiration: asOptional(asString),
  // inboundAddress: asOptional(asString),
  targetAddress: asString,
  tx: asOptional(asEither(asEvmCleaner, asCosmosCleaner)),
  memo: asOptional(asString)
  // txType
})

const asThorSwapQuoteResponse = asObject({
  routes: asArray(asMaybe(asThorSwapRoute))
})

const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      swapkit: asObject({
        daVolatilitySpread: asOptional(asNumber),
        affiliateFeeBasis: asOptional(asString)
      })
    })
  })
})

const asInitOptions = asObject({
  appId: asOptional(asString, 'edge'),
  affiliateFeeBasis: asOptional(asString, AFFILIATE_FEE_BASIS_DEFAULT),
  ninerealmsClientId: asOptional(asString, ''),
  thorname: asOptional(asString, 'ej'),
  thorswapApiKey: asOptional(asString),
  thorswapXApiKey: asOptional(asString)
})

/** Max slippage for 5% for estimated quotes */
const DA_VOLATILITY_SPREAD_DEFAULT = 0.05
const THORSWAP_DEFAULT_SERVERS = ['https://api.swapkit.dev']

type ExchangeInfo = ReturnType<typeof asExchangeInfo>

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0

export function makeSwapKitPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { appId, thorname, thorswapApiKey, thorswapXApiKey } = asInitOptions(
    opts.initOptions
  )
  let { affiliateFeeBasis } = asInitOptions(opts.initOptions)

  const thorswapHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': thorswapXApiKey,
    referer: thorswapApiKey
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const {
      fromCurrencyCode,
      toCurrencyCode,
      nativeAmount,
      fromWallet,
      fromTokenId,
      toWallet,
      toTokenId,
      quoteFor
    } = request
    // Do not support transfer between same assets
    if (
      fromWallet.currencyInfo.pluginId === toWallet.currencyInfo.pluginId &&
      request.fromCurrencyCode === request.toCurrencyCode
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    const reverseQuote = quoteFor === 'to'
    const isEstimate = true

    let daVolatilitySpread: number = DA_VOLATILITY_SPREAD_DEFAULT
    const thorswapServers: string[] = THORSWAP_DEFAULT_SERVERS

    checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

    // Grab addresses:
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
          log.warn('Error getting info server exchangeInfo. Using defaults...')
        }
      } catch (e: any) {
        log.warn(
          'Error getting info server exchangeInfo. Using defaults...',
          e.message
        )
      }
    }

    if (exchangeInfo != null) {
      const { swapkit } = exchangeInfo.swap.plugins
      affiliateFeeBasis = swapkit.affiliateFeeBasis ?? affiliateFeeBasis
      daVolatilitySpread =
        swapkit.daVolatilitySpread ?? DA_VOLATILITY_SPREAD_DEFAULT
    }

    const volatilitySpreadFinal = daVolatilitySpread // Might add a likeKind spread later

    //
    // Get Quote
    //
    if (reverseQuote) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const sellAmount = await fromWallet.nativeToDenomination(
      nativeAmount,
      fromCurrencyCode
    )

    const quoteParams: ThorSwapQuoteParams = {
      sellAsset:
        `${fromMainnetCode}.${fromCurrencyCode}` +
        (fromTokenId != null ? `-0x${fromTokenId}` : ''),
      buyAsset:
        `${toMainnetCode}.${toCurrencyCode}` +
        (toTokenId != null ? `-0x${toTokenId}` : ''),
      sellAmount,
      slippage: volatilitySpreadFinal * 100,
      destinationAddress: toAddress,
      sourceAddress: fromAddress,
      includeTx: true,
      referer: thorswapApiKey,
      affiliate: thorname,
      affiliateFee: parseInt(affiliateFeeBasis)
    }
    const sourceTokenContractAddress =
      fromTokenId != null ? `0x${fromTokenId}` : undefined
    const uri = `quote`

    const thorSwapResponse = await fetchWaterfall(
      fetchCors,
      thorswapServers,
      uri,
      {
        method: 'POST',
        headers: thorswapHeaders,
        body: JSON.stringify(quoteParams)
      }
    )

    if (!thorSwapResponse.ok) {
      const responseText = await thorSwapResponse.text()
      if (responseText.includes('No routes found for ')) {
        log.warn('No routes found')
        throw new SwapCurrencyError(swapInfo, request)
      }
      throw new Error(
        `SwapKit could not get thorswap quote: ${JSON.stringify(
          responseText,
          null,
          2
        )}`
      )
    }

    const thorSwapJson = await thorSwapResponse.json()
    const thorSwapQuote = asThorSwapQuoteResponse(thorSwapJson)

    const routes = thorSwapQuote.routes.filter(
      (r: any): r is ReturnType<typeof asThorSwapRoute> => r != null
    )

    const thorSwap = routes
      .sort((a, b) => (gt(a.expectedBuyAmount, b.expectedBuyAmount) ? -1 : 1))
      .find(
        route =>
          // route.providers.length > 1 &&
          route.providers.includes('THORCHAIN') ||
          route.providers.includes('MAYACHAIN')
      )

    if (thorSwap == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const { expectedBuyAmount, providers, targetAddress, expiration } = thorSwap

    const toNativeAmount = toFixed(
      await toWallet.denominationToNative(expectedBuyAmount, toCurrencyCode),
      0,
      0
    )

    let memoType: EdgeMemo['type'] = 'hex'
    let memo = ''

    const publicAddress = targetAddress
    const preTxs: EdgeTransaction[] = []

    const evmTransaction = asMaybe(asEvmCleaner)(thorSwap.tx)
    const cosmosTransaction = asMaybe(asCosmosCleaner)(thorSwap.tx)
    if (evmTransaction != null) {
      // EVM
      if (fromMainnetCode !== fromCurrencyCode) {
        if (sourceTokenContractAddress == null) {
          throw new Error(
            `Missing sourceTokenContractAddress for ${fromMainnetCode}`
          )
        }

        const dexContractAddress = asString(thorSwap.meta.approvalAddress)

        const approvalTxs = await createEvmApprovalEdgeTransactions({
          request,
          approvalAmount: nativeAmount,
          tokenContractAddress: sourceTokenContractAddress,
          recipientAddress: dexContractAddress,
          networkFeeOption: 'high'
        })
        preTxs.push(...approvalTxs)
      }
      memo = evmTransaction.data.replace(/^0x/, '')
    } else if (cosmosTransaction != null) {
      // COSMOS
      // We can add cosmos support later
      throw new SwapCurrencyError(swapInfo, request)
    } else {
      // UTXO
      if (
        // Cannot yet do tokens on non-EVM chains
        fromMainnetCode !== fromCurrencyCode ||
        // Require memo existence for UTXO chains
        thorSwap.memo == null
      ) {
        throw new SwapCurrencyError(swapInfo, request)
      }
      memo = thorSwap.memo
      memoType = 'text'
    }

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount,
          publicAddress
        }
      ],
      networkFeeOption: 'high',
      assetAction: {
        assetActionType: 'swap'
      },
      memos: memo == null ? undefined : [{ type: memoType, value: memo }],
      savedAction: {
        actionType: 'swap',
        swapInfo,
        isEstimate,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: toWallet.id,
        refundAddress: fromAddress
      },
      otherParams: {
        outputSort: 'targets'
      }
    }

    if (EVM_CURRENCY_CODES[fromMainnetCode]) {
      if (fromMainnetCode === fromCurrencyCode) {
        // For mainnet coins of EVM chains, use gasLimit override since makeSpend doesn't
        // know how to estimate an ETH spend with extra data
        const gasLimit = getGasLimit(fromMainnetCode, fromTokenId)
        if (gasLimit != null) {
          spendInfo.customNetworkFee = {
            ...spendInfo.customNetworkFee,
            gasLimit
          }
        }
      }
    }

    const providersStr = providers.join(' -> ')
    const notes = `DEX Providers: ${providersStr}`

    const expirationMs =
      expiration != null
        ? parseInt(`${expiration}000`) // expiration provided as seconds
        : Date.now() + EXPIRATION_MS

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: nativeAmount,
      expirationDate: new Date(expirationMs),
      preTxs,
      metadataNotes: notes
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      const newRequest = await getMaxSwappable(fetchSwapQuoteInner, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}
