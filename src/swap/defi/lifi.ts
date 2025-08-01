import { mul, round } from 'biggystring'
import {
  asArray,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import { div18 } from '../../util/biggystringplus'
import {
  checkInvalidCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
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
import { asNumberString, EdgeSwapRequestPlugin, StringMap } from '../types'
import { getEvmApprovalData, WEI_MULTIPLIER } from './defiUtils'

const pluginId = 'lifi'
const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: true,
  displayName: 'LI.FI',
  supportEmail: 'support@edge.app'
}

const asInitOptions = asObject({
  affiliateFeeBasis: asOptional(asString, '50'),
  appId: asOptional(asString, 'edge'),
  integrator: asOptional(asString, 'edgeapp')
})

/** Allow up to 5% slippage even for variable rate quotes */
const MAX_SLIPPAGE = '0.05'
const LIFI_SERVERS_DEFAULT = ['https://li.quest']
const EXPIRATION_MS = 1000 * 60
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000

// https://li.quest/v1/chains
const getParentTokenContractAddress = (pluginId: string): string => {
  switch (pluginId) {
    // chainType UTXO
    case 'bitcoin': {
      return 'bitcoin'
    }

    // chainType SVM
    case 'solana': {
      return '11111111111111111111111111111111'
    }

    // chainType EVM
    case 'celo': {
      return '0x471EcE3750Da237f93B8E339c536989b8978a438'
    }
    case 'metis': {
      return '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000'
    }
    default: {
      return '0x0000000000000000000000000000000000000000'
    }
  }
}

export const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

// Network names that don't match parent network currency code
// See https://docs.li.fi/list-chains-bridges-dexs#chains
const MAINNET_CODE_TRANSCRIPTION: StringMap = {
  arbitrum: 'ARB',
  aurora: 'AUR',
  avalanche: 'AVA',
  base: 'BAS',
  binancesmartchain: 'BSC',
  celo: 'CEL',
  cronos: 'CRO',
  ethereum: 'ETH',
  evmos: 'EVM',
  fantom: 'FTM',
  fuse: 'FUS',
  gnosis: 'DAI',
  harmony: 'ONE',
  hyperevm: 'HYP',
  metis: 'MAM',
  moonbeam: 'MOO',
  moonriver: 'MOR',
  okexchain: 'OKT',
  optimism: 'OPT',
  polygon: 'POL',
  rsk: 'RSK',
  solana: 'SOL',
  velas: 'VEL',
  zksync: 'ERA'
}

const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      lifi: asOptional(
        asObject({
          // perAssetSpread: asOptional(asArray(asAssetSpread)),
          // volatilitySpread: asOptional(asNumber),
          // likeKindVolatilitySpread: asOptional(asNumber),
          // daVolatilitySpread: asOptional(asNumber),
          lifiServers: asOptional(asArray(asString))
        })
      )
    })
  })
})

// const asToken = asObject({
//   address: asString, // "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
//   chainId: asNumber, // 137,
//   symbol: asString, // "USDC",
//   decimals: asNumber, // 6,
//   name: asString, // "USDC",
//   priceUSD: asNumberString, // "1",
//   coinKey: asString // "USDC"
// })

// const asAction = asObject({
//   fromChainId: asNumber,
//   fromAmount: asNumberString,
//   fromToken: asToken,
//   toChainId: asNumber,
//   toToken: asToken
// })

// const asFeeCost = asObject({
//   amount: asNumberString, // "56495962827064236208",
//   token: asToken
// })

const asEstimate = asObject({
  fromAmount: asNumberString, // "400000",
  toAmount: asNumberString, // "237318132569913",
  toAmountMin: asNumberString, // "225452225941418",
  approvalAddress: asString, // "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  executionDuration: asNumber // 1168,
  // feeCosts: asArray(asFeeCost)
})

const asTransactionRequest = asObject({
  data: asString,
  to: asString, // '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
  value: asString, // '0x00'
  from: asString, // '0x0b0901e9cef9eaed5753519177e3c7cfd0ef96ef'
  chainId: asNumber, // 1
  gasPrice: asString, // '0x03aca2109d'
  gasLimit: asString // '0x08a3df'
})

const asTransactionRequestSolana = asObject({
  data: asString
})

const asIncludedStep = asObject({
  estimate: asOptional(asEstimate),
  toolDetails: asObject({
    name: asString
  })
})

const asV1Quote = asObject({
  id: asString,
  type: asString,
  estimate: asEstimate,
  includedSteps: asArray(asIncludedStep),
  // action: asAction,
  transactionRequest: asUnknown
})

type ExchangeInfo = ReturnType<typeof asExchangeInfo>

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0

export function makeLifiPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io, log } = opts
  const { affiliateFeeBasis } = asInitOptions(opts.initOptions)
  const affiliateFee = div18(affiliateFeeBasis, '10000')

  const headers = {
    'Content-Type': 'application/json'
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const {
      fromCurrencyCode,
      fromTokenId,
      toCurrencyCode,
      toTokenId,
      nativeAmount,
      fromWallet,
      toWallet,
      quoteFor
    } = request
    if (quoteFor !== 'from') {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromToken = fromWallet.currencyConfig.allTokens[fromTokenId ?? '']
    let fromContractAddress
    let sendingToken = false
    if (fromCurrencyCode === fromWallet.currencyInfo.currencyCode) {
      fromContractAddress = getParentTokenContractAddress(
        fromWallet.currencyInfo.pluginId
      )
    } else {
      sendingToken = true
      fromContractAddress = fromToken?.networkLocation?.contractAddress
    }

    const toToken = toWallet.currencyConfig.allTokens[toTokenId ?? '']
    let toContractAddress
    if (toCurrencyCode === toWallet.currencyInfo.currencyCode) {
      toContractAddress = getParentTokenContractAddress(
        toWallet.currencyInfo.pluginId
      )
    } else {
      toContractAddress = toToken?.networkLocation?.contractAddress
    }

    if (fromContractAddress == null || toContractAddress == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const { appId, integrator } = asInitOptions(opts.initOptions)
    const { fetchCors = io.fetch } = io

    // Do not support transfer between same assets
    if (
      fromWallet.currencyInfo.pluginId === toWallet.currencyInfo.pluginId &&
      request.fromCurrencyCode === request.toCurrencyCode
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    let lifiServers: string[] = LIFI_SERVERS_DEFAULT

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
      const { lifi } = exchangeInfo.swap.plugins
      lifiServers = lifi?.lifiServers ?? lifiServers
    }

    const params = makeQueryParams({
      fromChain: fromMainnetCode,
      toChain: toMainnetCode,
      fromToken: fromContractAddress,
      toToken: toContractAddress,
      fromAmount: nativeAmount,
      fromAddress,
      toAddress,
      integrator,
      slippage: MAX_SLIPPAGE,
      fee: affiliateFee
    })
    // Get current pool
    const [quoteResponse] = await Promise.all([
      fetchWaterfall(fetchCors, lifiServers, `v1/quote?${params}`, {
        headers
      })
    ])

    if (!quoteResponse.ok) {
      const responseText = await quoteResponse.text()

      if (responseText.includes('AMOUNT_TOO_LOW'))
        throw new SwapBelowLimitError(swapInfo, undefined, 'from')

      throw new Error(`Lifi could not fetch v1/quote: ${responseText}`)
    }

    const quoteJson = await quoteResponse.json()

    const quote = asV1Quote(quoteJson)
    const {
      estimate,
      includedSteps,
      transactionRequest: transactionRequestRaw
    } = quote
    const providers = includedSteps.map(s => s.toolDetails.name)
    const providersStr = providers.join(' -> ')
    const metadataNotes = `DEX Providers: ${providersStr}`
    const { approvalAddress, toAmount, toAmountMin, fromAmount } = estimate

    let preTx: EdgeTransaction | undefined
    let spendInfo: EdgeSpendInfo
    switch (fromWallet.currencyInfo.pluginId) {
      case 'solana': {
        const publicAddress = includedSteps[0].estimate?.approvalAddress
        if (publicAddress == null) {
          log.warn('No public address provided in quote')
          throw new SwapCurrencyError(swapInfo, request)
        }
        const { data } = asTransactionRequestSolana(transactionRequestRaw)

        spendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount: fromAmount,
              publicAddress: publicAddress
            }
          ],
          otherParams: { unsignedTx: data },
          memos: [],
          networkFeeOption: 'high',
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
              nativeAmount: toAmount
            },
            fromAsset: {
              pluginId: fromWallet.currencyInfo.pluginId,
              tokenId: fromTokenId,
              nativeAmount: fromAmount
            },
            payoutAddress: toAddress,
            payoutWalletId: toWallet.id,
            refundAddress: fromAddress
          }
        }

        break
      }
      default: {
        const transactionRequest = asTransactionRequest(transactionRequestRaw)
        const { data, gasLimit, gasPrice } = transactionRequest
        const gasPriceDecimal = hexToDecimal(gasPrice)
        const gasPriceGwei = div18(gasPriceDecimal, WEI_MULTIPLIER)

        if (sendingToken) {
          const approvalData = await getEvmApprovalData({
            contractAddress: approvalAddress,
            assetAddress: fromContractAddress,
            nativeAmount
          })

          const preTxSpendInfo: EdgeSpendInfo = {
            // Token approvals only spend the parent currency
            tokenId: null,
            spendTargets: [
              {
                nativeAmount: '0',
                publicAddress: fromContractAddress
              }
            ],
            memos:
              approvalData != null
                ? [{ type: 'hex', value: approvalData }]
                : undefined,
            networkFeeOption: 'custom',
            customNetworkFee: {
              gasPrice: gasPriceGwei
            },
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
              contractAddress: approvalAddress
            }
          }
          preTx = await request.fromWallet.makeSpend(preTxSpendInfo)
        }

        spendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount: fromAmount,
              publicAddress: approvalAddress
            }
          ],
          memos: [{ type: 'hex', value: data.replace(/^0x/, '') }],
          networkFeeOption: 'custom',
          customNetworkFee: {
            // XXX Hack. Lifi doesn't properly estimate ethereum gas limits. Increase by 40%
            gasLimit: round(mul(hexToDecimal(gasLimit), '1.4'), 0),
            gasPrice: gasPriceGwei
          },
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
              nativeAmount: toAmount
            },
            fromAsset: {
              pluginId: fromWallet.currencyInfo.pluginId,
              tokenId: fromTokenId,
              nativeAmount: fromAmount
            },
            payoutAddress: toAddress,
            payoutWalletId: toWallet.id,
            refundAddress: fromAddress
          }
        }
      }
    }

    return {
      expirationDate: new Date(Date.now() + EXPIRATION_MS),
      fromNativeAmount: nativeAmount,
      metadataNotes,
      minReceiveAmount: toAmountMin,
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
          newRequest = { ...request, nativeAmount: maxAmount, quoteFor: 'from' }
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
