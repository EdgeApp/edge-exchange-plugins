import { add, div, gt, lt, mul, round } from 'biggystring'
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
  EdgeCurrencyConfig,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTokenId,
  EdgeTransaction,
  InsufficientFundsError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'
import { base64 } from 'rfc4648'

import { lifi as lifiMapping } from '../../mappings/lifi'
import { div18 } from '../../util/biggystringplus'
import {
  checkInvalidTokenIds,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToStringMap,
  NATIVE_ERC20_INTERFACES,
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
import {
  asNumberString,
  EdgeSwapRequestPlugin,
  MakeTxParams,
  StringMap
} from '../types'
import {
  bufferSwapGasPrice,
  createEvmApprovalEdgeTransactions
} from './defiUtils'

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

const LIFI_SERVERS_DEFAULT = ['https://li.quest']
const EXPIRATION_MS = 1000 * 60
const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

    // chainType SUI
    case 'sui': {
      return '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
    }

    // chainType EVM
    case 'celo': {
      return '0x471EcE3750Da237f93B8E339c536989b8978a438'
    }
    case 'metis': {
      return '0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000'
    }
    default: {
      return ZERO_ADDRESS
    }
  }
}

/** One side of a swap, as LI.FI names and counts it. */
export interface LifiAsset {
  /** The token LI.FI quotes, such as 0x3600…0000 for Arc's USDC */
  address: string
  /** LI.FI's decimals for it, checked against the quote's `action` */
  decimals: number
  /** Wallet native units per LI.FI unit: '1' unless LI.FI counts coarser */
  scale: string
}

const getDecimals = (multiplier: string): number => multiplier.length - 1

/**
 * Resolves the asset LI.FI trades for one side of a request, or undefined
 * when the token has no contract address to quote.
 */
export const getLifiAsset = (
  currencyConfig: Pick<EdgeCurrencyConfig, 'allTokens' | 'currencyInfo'>,
  tokenId: EdgeTokenId
): LifiAsset | undefined => {
  if (tokenId != null) {
    const token = currencyConfig.allTokens[tokenId]
    const address: unknown = token?.networkLocation?.contractAddress
    if (typeof address !== 'string') return
    return {
      address,
      decimals: getDecimals(token.denominations[0].multiplier),
      scale: '1'
    }
  }

  const { denominations, pluginId } = currencyConfig.currencyInfo
  const { multiplier } = denominations[0]
  const nativeInterface = NATIVE_ERC20_INTERFACES[pluginId]
  if (nativeInterface != null) {
    return {
      address: nativeInterface.contractAddress,
      decimals: getDecimals(nativeInterface.multiplier),
      scale: div(multiplier, nativeInterface.multiplier)
    }
  }
  return {
    address: getParentTokenContractAddress(pluginId),
    decimals: getDecimals(multiplier),
    scale: '1'
  }
}

/**
 * Converts a wallet amount to LI.FI's units, dropping the digits LI.FI
 * cannot express.
 */
export const toLifiAmount = (nativeAmount: string, from: LifiAsset): string => {
  const lifiAmount = div(nativeAmount, from.scale)
  if (lifiAmount === '0') {
    throw new SwapBelowLimitError(swapInfo, from.scale, 'from')
  }
  return lifiAmount
}

/** Converts a quote's amounts from LI.FI's units to each wallet's. */
export const toWalletAmounts = (
  estimate: { fromAmount: string; toAmount: string; toAmountMin: string },
  from: LifiAsset,
  to: LifiAsset
): { fromAmount: string; toAmount: string; toAmountMin: string } => ({
  fromAmount: mul(estimate.fromAmount, from.scale),
  toAmount: mul(estimate.toAmount, to.scale),
  toAmountMin: mul(estimate.toAmountMin, to.scale)
})

/**
 * Fails the quote when LI.FI priced a different token, or the same token at
 * a different precision, than the request assumed. Every amount is scaled on
 * that assumption, so a mismatch would show amounts off by a power of ten.
 */
export const checkLifiToken = (
  token: { address: string; decimals: number },
  expected: LifiAsset,
  request: EdgeSwapRequest
): void => {
  if (
    token.address.toLowerCase() !== expected.address.toLowerCase() ||
    token.decimals !== expected.decimals
  ) {
    throw new SwapCurrencyError(swapInfo, request)
  }
}

/**
 * A swap either sends its source asset as the call's value, or has LI.FI's
 * contract pull it against an approval. Tokens are always pulled. A native
 * asset is pulled when the call carries no value, which is how LI.FI trades
 * Arc's USDC today.
 */
export const pullsFromWallet = (
  fromTokenId: EdgeTokenId,
  transactionValue: string
): boolean => fromTokenId != null || hexToDecimal(transactionValue) === '0'

/**
 * The spend and the approval both take LI.FI's amount, so a quote spending
 * more than was asked would take more than the user agreed to.
 */
export const checkQuotedAmount = (
  quotedAmount: string,
  requestedAmount: string
): void => {
  if (gt(quotedAmount, requestedAmount)) {
    throw new Error(
      `LI.FI quoted ${quotedAmount}, above the requested ${requestedAmount}`
    )
  }
}

export const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {
    zcash: [null]
  }
}

// Network names that don't match parent network currency code
// See https://docs.li.fi/list-chains-bridges-dexs#chains
const MAINNET_CODE_TRANSCRIPTION: StringMap = mapToStringMap(lifiMapping)

const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      lifi: asOptional(
        asObject({
          // perAssetSpread: asOptional(asArray(asAssetSpread)),
          // volatilitySpread: asOptional(asNumber),
          // likeKindVolatilitySpread: asOptional(asNumber),
          // daVolatilitySpread: asOptional(asNumber),
          lifiServers: asOptional(asArray(asString)),

          /**
           * Maximum slippage as a decimal, ie 0.01 for 1%. Overrides the
           * slippage LI.FI picks for the pair, so an unresponsive route can be
           * loosened without shipping a client release.
           *
           * The info server does not serve this yet: its own `asExchangeInfo`
           * enumerates `swap.plugins` without a `lifi` block and drops unknown
           * keys, which is also why `lifiServers` above never arrives. Adding
           * that block is what turns both into live config.
           */
          slippage: asOptional(asNumber)
        })
      )
    })
  })
})

const asToken = asObject({
  address: asString, // "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
  decimals: asNumber // 6,
})

const asAction = asObject({
  fromToken: asToken,
  toToken: asToken
})

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

const asTransactionRequestSui = asObject({
  data: asString
})

const asIncludedStep = asObject({
  toolDetails: asObject({
    name: asString
  })
})

const asV1Quote = asObject({
  id: asString,
  type: asString,
  estimate: asEstimate,
  includedSteps: asArray(asIncludedStep),
  action: asAction,
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

  /**
   * `maxProbe` skips the plugin's own balance check on a pulled native asset:
   * the probe quotes the whole balance to learn the fees a max swap leaves
   * room for. The quote the user gets is checked like any other.
   */
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    maxProbe: boolean = false
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

    const from = getLifiAsset(fromWallet.currencyConfig, fromTokenId)
    const to = getLifiAsset(toWallet.currencyConfig, toTokenId)
    if (from == null || to == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const { appId, integrator } = asInitOptions(opts.initOptions)
    const { fetchCors = io.fetch } = io

    // Do not support transfer between same assets
    if (
      fromWallet.currencyInfo.pluginId === toWallet.currencyInfo.pluginId &&
      request.fromTokenId === request.toTokenId
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    let lifiServers: string[] = LIFI_SERVERS_DEFAULT

    checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)

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

    let slippage: number | undefined
    if (exchangeInfo != null) {
      const { lifi } = exchangeInfo.swap.plugins
      lifiServers = lifi?.lifiServers ?? lifiServers
      slippage = lifi?.slippage
    }

    const lifiFromAmount = toLifiAmount(nativeAmount, from)

    const params = makeQueryParams({
      fromChain: fromMainnetCode,
      toChain: toMainnetCode,
      fromToken: from.address,
      toToken: to.address,
      fromAmount: lifiFromAmount,
      fromAddress,
      toAddress,
      integrator,
      fee: affiliateFee,
      // Omitting `slippage` lets LI.FI pick it per pair, which is far tighter
      // than a blanket maximum on liquid pairs and shrinks the window a
      // sandwich bot can extract. `makeQueryParams` emits a valueless key for
      // undefined, so the param has to be left out rather than passed empty.
      ...(slippage != null ? { slippage } : {})
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
      action,
      estimate,
      includedSteps,
      transactionRequest: transactionRequestRaw
    } = quote
    checkLifiToken(action.fromToken, from, request)
    checkLifiToken(action.toToken, to, request)
    checkQuotedAmount(estimate.fromAmount, lifiFromAmount)

    const providers = includedSteps.map(s => s.toolDetails.name)
    const providersStr = providers.join(' -> ')
    const metadataNotes = `DEX Providers: ${providersStr}`
    const { approvalAddress } = estimate
    // Everything below is in wallet units. `estimate.fromAmount` stays in
    // LI.FI's units for the approval, which the token contract reads.
    const { fromAmount, toAmount, toAmountMin } = toWalletAmounts(
      estimate,
      from,
      to
    )

    const preTxs: EdgeTransaction[] = []
    let spendInfo: EdgeSpendInfo
    switch (fromWallet.currencyInfo.pluginId) {
      case 'solana': {
        const { data } = asTransactionRequestSolana(transactionRequestRaw)

        spendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount: fromAmount,
              // The engine signs the prebuilt `unsignedTx` and only checks
              // balances against this target, so it has to be a Solana
              // address other than the wallet's own. No address in the quote
              // is one on every route, so use the asset's own address: the
              // system program for SOL, or the mint for a token.
              publicAddress: from.address
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
      case 'sui': {
        // SUI uses pre-built transactions via makeTx
        const { data } = asTransactionRequestSui(transactionRequestRaw)

        // Convert base64 to Uint8Array for makeTx
        const unsignedTx = base64.parse(data)

        // Create makeTxParams using the new MakeTx type
        const makeTxParams: MakeTxParams = {
          type: 'MakeTx',
          unsignedTx,
          metadata: {
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

        // Return SwapOrder with makeTxParams for SUI
        return {
          expirationDate: new Date(Date.now() + EXPIRATION_MS),
          fromNativeAmount: fromAmount,
          metadataNotes,
          minReceiveAmount: toAmountMin,
          makeTxParams,
          request,
          swapInfo
        }
      }
      default: {
        const transactionRequest = asTransactionRequest(transactionRequestRaw)
        const { data, gasLimit, gasPrice, value } = transactionRequest
        const pulled = pullsFromWallet(fromTokenId, value)
        const gasPriceDecimal = hexToDecimal(gasPrice)
        const gasPriceGwei = bufferSwapGasPrice(gasPriceDecimal)

        // XXX Hack. Lifi doesn't properly estimate ethereum gas limits. Increase by 40%
        const swapGasLimit = round(mul(hexToDecimal(gasLimit), '1.4'), 0)

        // A pulled native asset needs a token contract to approve, which
        // only a chain with an ERC-20 interface to its native balance has:
        if (pulled && fromTokenId == null && from.address === ZERO_ADDRESS) {
          throw new SwapCurrencyError(swapInfo, request)
        }

        if (pulled) {
          const approvalTxs = await createEvmApprovalEdgeTransactions({
            request,
            approvalAmount: estimate.fromAmount,
            savedActionAmount: fromAmount,
            tokenContractAddress: from.address,
            recipientAddress: approvalAddress,
            networkFeeOption: 'custom',
            customNetworkFee: {
              gasPrice: gasPriceGwei
            }
          })
          preTxs.push(...approvalTxs)
        }

        // A pulled token is spent as a token transfer, which the engine
        // checks against the token balance. A pulled native asset has no
        // such spend: the call sends no value, so the engine's balance check
        // covers only its fee while LI.FI's contract spends the balance.
        const pulledNative = pulled && fromTokenId == null
        if (pulledNative && !maxProbe) {
          // The swap must leave room for itself and for the approval fees.
          const swapFee = mul(swapGasLimit, mul(gasPriceGwei, '1000000000'))
          const fees = preTxs.reduce(
            (sum, preTx) => add(sum, preTx.networkFee),
            swapFee
          )
          const balance = fromWallet.balanceMap.get(null) ?? '0'
          if (lt(balance, add(fromAmount, fees))) {
            throw new InsufficientFundsError({ tokenId: null })
          }
        }

        spendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount: pulledNative ? '0' : fromAmount,
              publicAddress: approvalAddress
            }
          ],
          memos: [{ type: 'hex', value: data.replace(/^0x/, '') }],
          networkFeeOption: 'custom',
          customNetworkFee: {
            gasLimit: swapGasLimit,
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
      fromNativeAmount: fromAmount,
      metadataNotes,
      minReceiveAmount: toAmountMin,
      preTxs,
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
          newRequest = await getMaxSwappable(fetchSwapQuoteInner, request, true)
        }
      }
      const swapOrder = await fetchSwapQuoteInner(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }
  return out
}
