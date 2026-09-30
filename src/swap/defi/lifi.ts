import { lte, mul, round } from 'biggystring'
import {
  asArray,
  asMaybe,
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
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeTransaction,
  EdgeTxAction,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'
import { base64 } from 'rfc4648'

import { lifi as lifiMapping } from '../../mappings/lifi'
import { div18 } from '../../util/biggystringplus'
import {
  checkInvalidTokenIds,
  getCurrencyMultiplier,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToStringMap,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  fetchInfo,
  fetchWaterfall,
  getAddress,
  hexToDecimal,
  makeQueryParams,
  promiseWithTimeout,
  snooze
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

    // chainType HyperCore, addressed like its spot tokens (see below)
    case 'hypercore': {
      return '0x0D01DC56DcaaCa66aD901c959B4011ec00000000'
    }
    default: {
      return '0x0000000000000000000000000000000000000000'
    }
  }
}

/**
 * LI.FI names a HyperCore spot token by its 16-byte token id, zero-padded to
 * an EVM-sized address. Edge stores the bare 16-byte id.
 */
const getLifiTokenAddress = (
  pluginId: string,
  contractAddress: string
): string =>
  pluginId === 'hypercore' ? `${contractAddress}00000000` : contractAddress

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

const asTransactionRequestSui = asObject({
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

/**
 * A step that runs by signing messages LI.FI relays, rather than by sending a
 * transaction. This is how LI.FI moves funds out of HyperCore.
 */
const asV1MessageStep = asObject({
  executionType: asValue('message'),
  typedData: asArray(
    asObject({ primaryType: asString, message: asUnknown }).withRest
  )
})

/** Ties the relay's deposit to our address. */
const asNonceMapping = asObject({
  wallet: asString,
  depositor: asString
})

/** The HyperCore transfer that funds the route. */
const asSendAsset = asObject({
  sourceDex: asValue('spot'),
  fromSubAccount: asValue(''),
  token: asString,
  amount: asString,
  nonce: asNumber
})

const asMaybeNonceMapping = asMaybe(asNonceMapping)
const asMaybeSendAsset = asMaybe(asSendAsset)

/**
 * Checks that a message route signs only a nonce mapping for our own address
 * and one spot transfer of the quoted token, for no more than the amount
 * the user requested. Anything else, such as the agent keys and orders of Hyperliquid
 * trading steps, would let LI.FI's payload move funds the user never saw.
 * Returns the transfer's nonce, or undefined to refuse the route.
 */
const checkMessageStep = (
  typedData: Array<{ primaryType: string; message: unknown }>,
  fromAddress: string,
  lifiTokenAddress: string,
  maxAmount: string,
  multiplier: string
): number | undefined => {
  // LI.FI pads the 16-byte token id that HyperCore names tokens by:
  const tokenId = lifiTokenAddress.toLowerCase().slice(0, -8)
  const sends: number[] = []
  for (const { primaryType, message } of typedData) {
    if (primaryType === 'NonceMapping') {
      const mapping = asMaybeNonceMapping(message)
      if (
        mapping == null ||
        mapping.wallet.toLowerCase() !== fromAddress.toLowerCase() ||
        mapping.depositor.toLowerCase() !== fromAddress.toLowerCase()
      ) {
        return
      }
    } else if (primaryType === 'HyperliquidTransaction:SendAsset') {
      const send = asMaybeSendAsset(message)
      if (
        send == null ||
        send.token.split(':')[1]?.toLowerCase() !== tokenId ||
        !lte(mul(send.amount, multiplier), maxAmount)
      ) {
        return
      }
      sends.push(send.nonce)
    } else {
      return
    }
  }
  return sends.length === 1 ? sends[0] : undefined
}

const asRelayResponse = asObject({
  status: asValue('ok'),
  data: asObject({
    taskId: asString
  })
})

const asRelayStatus = asObject({
  status: asString,
  substatusMessage: asOptional(asString),
  sending: asOptional(
    asObject({
      txHash: asOptional(asString)
    })
  )
})

const RELAY_STATUS_POLL_MS = 2000
const RELAY_STATUS_TIMEOUT_MS = 1000 * 60 * 2

const asMaybeV1MessageStep = asMaybe(asV1MessageStep)
const asMaybeRelayResponse = asMaybe(asRelayResponse)
const asMaybeRelayStatus = asMaybe(asRelayStatus)

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
  ): Promise<SwapOrder | EdgeSwapQuote> => {
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
      const contractAddress: string | undefined =
        fromToken?.networkLocation?.contractAddress
      fromContractAddress =
        contractAddress == null
          ? undefined
          : getLifiTokenAddress(
              fromWallet.currencyInfo.pluginId,
              contractAddress
            )
    }

    const toToken = toWallet.currencyConfig.allTokens[toTokenId ?? '']
    let toContractAddress
    if (toCurrencyCode === toWallet.currencyInfo.currencyCode) {
      toContractAddress = getParentTokenContractAddress(
        toWallet.currencyInfo.pluginId
      )
    } else {
      const contractAddress: string | undefined =
        toToken?.networkLocation?.contractAddress
      toContractAddress =
        contractAddress == null
          ? undefined
          : getLifiTokenAddress(toWallet.currencyInfo.pluginId, contractAddress)
    }

    if (fromContractAddress == null || toContractAddress == null) {
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

    const params = makeQueryParams({
      fromChain: fromMainnetCode,
      toChain: toMainnetCode,
      fromToken: fromContractAddress,
      toToken: toContractAddress,
      fromAmount: nativeAmount,
      fromAddress,
      toAddress,
      integrator,
      fee: affiliateFee,
      // Routes out of HyperCore only exist as signed messages:
      ...(fromWallet.currencyInfo.pluginId === 'hypercore'
        ? { executionType: 'all' }
        : {}),
      // LI.FI scales Mayan's 6-decimal HyperCore USDC amounts by its own
      // 8-decimal token, quoting 100 times too little, so Mayan stays off
      // HyperCore routes:
      ...(fromWallet.currencyInfo.pluginId === 'hypercore' ||
      toWallet.currencyInfo.pluginId === 'hypercore'
        ? { denyBridges: 'mayan' }
        : {}),
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
      estimate,
      includedSteps,
      transactionRequest: transactionRequestRaw
    } = quote
    const providers = includedSteps.map(s => s.toolDetails.name)
    const providersStr = providers.join(' -> ')
    const metadataNotes = `DEX Providers: ${providersStr}`
    const { approvalAddress, toAmount, toAmountMin, fromAmount } = estimate

    const messageStep = asMaybeV1MessageStep(quoteJson)
    if (messageStep != null) {
      const { typedData } = messageStep
      const nonce =
        fromWallet.currencyInfo.pluginId === 'hypercore'
          ? checkMessageStep(
              typedData,
              fromAddress,
              fromContractAddress,
              nativeAmount,
              getCurrencyMultiplier(
                fromWallet.currencyInfo,
                fromWallet.currencyConfig.allTokens,
                fromTokenId
              )
            )
          : undefined
      if (nonce == null) {
        throw new SwapCurrencyError(swapInfo, request)
      }

      const savedAction: EdgeTxAction = {
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
          nativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: toWallet.id,
        refundAddress: fromAddress
      }

      const approve = async (
        approveOpts?: EdgeSwapApproveOptions
      ): Promise<EdgeSwapResult> => {
        const signedTypedData: unknown[] = []
        for (const entry of typedData) {
          const signature = await fromWallet.signMessage(
            JSON.stringify(entry),
            { otherParams: { typedData: true } }
          )
          signedTypedData.push({ ...entry, signature })
        }

        const relayResponse = await fetchWaterfall(
          fetchCors,
          lifiServers,
          'v1/advanced/relay',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...quoteJson, typedData: signedTypedData })
          }
        )
        const relayText = await relayResponse.text()
        const relay = relayResponse.ok
          ? asMaybeRelayResponse(JSON.parse(relayText))
          : undefined
        if (relay == null) {
          throw new Error(`Lifi could not relay the swap: ${relayText}`)
        }
        const { taskId } = relay.data

        // The swap is committed once the relay accepts it. Wait for the
        // source-chain hash, which is also the wallet's own txid:
        const statusParams = makeQueryParams({
          taskId,
          fromChain: fromMainnetCode,
          toChain: toMainnetCode
        })
        const deadline = Date.now() + RELAY_STATUS_TIMEOUT_MS
        let txid: string | undefined
        while (txid == null && Date.now() < deadline) {
          await snooze(RELAY_STATUS_POLL_MS)
          const statusResponse = await fetchWaterfall(
            fetchCors,
            lifiServers,
            `v1/status?${statusParams}`,
            { headers }
          )
          if (!statusResponse.ok) continue
          const status = asMaybeRelayStatus(await statusResponse.json())
          txid = status?.sending?.txHash
          if (txid == null && status?.status === 'FAILED') {
            throw new Error(
              `Lifi relay task ${taskId} failed: ${
                status.substatusMessage ?? 'unknown'
              }`
            )
          }
        }
        // A slow hash does not undo the transfer. Save it under the stand-in
        // txid the HyperCore engine gives the ledger entry with this nonce:
        txid ??= `hypercore-nonce-${nonce}`

        const transaction: EdgeTransaction = {
          assetAction: { assetActionType: 'swap' },
          blockHeight: 0,
          currencyCode: request.fromCurrencyCode,
          date: Date.now() / 1000,
          isSend: true,
          memos: [],
          metadata: {
            ...approveOpts?.metadata,
            notes:
              approveOpts?.metadata?.notes != null
                ? `${metadataNotes}\n\n${approveOpts.metadata.notes}`
                : metadataNotes
          },
          nativeAmount: `-${nativeAmount}`,
          // HyperCore charges no gas for the relayed transfer:
          networkFee: '0',
          networkFees: [],
          ourReceiveAddresses: [],
          savedAction: { ...savedAction, orderId: taskId },
          signedTx: '',
          tokenId: fromTokenId,
          txid,
          walletId: fromWallet.id
        }
        await fromWallet.saveTx(transaction)

        return { orderId: taskId, transaction }
      }

      return {
        approve,
        close: async () => {},
        expirationDate: new Date(Date.now() + EXPIRATION_MS),
        fromNativeAmount: nativeAmount,
        isEstimate: true,
        minReceiveAmount: toAmountMin,
        networkFee: {
          currencyCode: fromWallet.currencyInfo.currencyCode,
          nativeAmount: '0',
          tokenId: null
        },
        pluginId,
        request,
        swapInfo,
        toNativeAmount: toAmount
      }
    }

    const preTxs: EdgeTransaction[] = []
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
          fromNativeAmount: nativeAmount,
          metadataNotes,
          minReceiveAmount: toAmountMin,
          makeTxParams,
          request,
          swapInfo
        }
      }
      default: {
        const transactionRequest = asTransactionRequest(transactionRequestRaw)
        const { data, gasLimit, gasPrice } = transactionRequest
        const gasPriceDecimal = hexToDecimal(gasPrice)
        const gasPriceGwei = bufferSwapGasPrice(gasPriceDecimal)

        if (sendingToken) {
          const approvalTxs = await createEvmApprovalEdgeTransactions({
            request,
            approvalAmount: fromAmount,
            tokenContractAddress: fromContractAddress,
            recipientAddress: approvalAddress,
            networkFeeOption: 'custom',
            customNetworkFee: {
              gasPrice: gasPriceGwei
            }
          })
          preTxs.push(...approvalTxs)
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
        // HyperCore transfers carry no gas, so its whole balance is swappable:
        if (
          request.fromTokenId != null ||
          request.fromWallet.currencyInfo.pluginId === 'hypercore'
        ) {
          const maxAmount =
            request.fromWallet.balanceMap.get(request.fromTokenId) ?? '0'
          newRequest = {
            ...request,
            nativeAmount: maxAmount,
            quoteFor: 'from'
          }
        } else {
          newRequest = await getMaxSwappable(async r => {
            const order = await fetchSwapQuoteInner(r)
            if ('approve' in order) throw new SwapCurrencyError(swapInfo, r)
            return order
          }, request)
        }
      }
      const order = await fetchSwapQuoteInner(newRequest)
      return 'approve' in order ? order : await makeSwapPluginQuote(order)
    }
  }
  return out
}
