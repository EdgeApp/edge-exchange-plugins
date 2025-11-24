import { gt, lt } from 'biggystring'
import {
  asArray,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  ChainCodeTickerMap,
  checkInvalidCodes,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import {
  convertRequest,
  denominationToNative,
  getAddress,
  memoType,
  nativeToDenomination
} from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'

const pluginId = 'changehero'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'ChangeHero',
  supportEmail: 'support@changehero.io'
}

const asInitOptions = asObject({
  apiKey: asString
})

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'algorand',
  arbitrum: 'arbitrum',
  avalanche: 'avalanche_(c-chain)',
  axelar: null,
  base: 'base',
  binance: null,
  binancesmartchain: 'binance_smart_chain',
  bitcoin: 'bitcoin',
  bitcoincash: 'bitcoin_cash',
  bitcoingold: null,
  bitcoinsv: 'bitcoin_sv',
  bobevm: null,
  cardano: 'cardano',
  celo: null,
  coreum: null,
  cosmoshub: 'cosmos',
  dash: 'dash',
  digibyte: 'digibyte',
  dogecoin: 'doge',
  eboost: null,
  ecash: 'xec',
  eos: null,
  ethereum: 'ethereum',
  ethereumclassic: 'ethereum_classic',
  ethereumpow: null,
  fantom: 'ftm',
  feathercoin: null,
  filecoin: null,
  filecoinfevm: null,
  fio: null,
  groestlcoin: null,
  hedera: 'hedera',
  hyperevm: 'hypeevm',
  liberland: null,
  litecoin: 'litecoin',
  monero: 'monero',
  optimism: 'optimism',
  osmosis: null,
  piratechain: null,
  pivx: null,
  polkadot: 'polkadot',
  polygon: 'polygon',
  pulsechain: null,
  qtum: 'qtum',
  ravencoin: null,
  ripple: 'ripple',
  rsk: null,
  smartcash: null,
  solana: 'solana',
  sonic: null,
  stellar: 'stellar',
  sui: 'sui',
  telos: null,
  tezos: 'tezos',
  thorchainrune: null,
  ton: 'ton',
  tron: 'tron',
  ufo: null,
  vertcoin: null,
  wax: null,
  zano: null,
  zcash: 'zcash',
  zcoin: null,
  zksync: null
}

// See https://changehero.io/currencies for list of supported currencies
// Or `curl -X POST 'https://api.changehero.io/v2' -H 'api-key: <your-api-key>' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"one","method":"getCurrenciesFull","params":{}}'`
const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC'] // ChangeHero doesn't support sending to shielded addresses
  }
}

const orderUri = 'https://changehero.io/transaction/'
const uri = 'https://api.changehero.io/v2'
const expirationFixedMs = 1000 * 60

const asGetFixRateReply = asObject({
  result: asArray(
    asObject({
      id: asString,
      maxFrom: asString,
      maxTo: asString,
      minFrom: asString,
      minTo: asString
      // from: asString,
      // to: asString,
    })
  )
})

const asCreateFixTransactionReply = asObject({
  result: asObject({
    id: asString,
    status: asString,
    amountExpectedFrom: asEither(asString, asNumber),
    amountExpectedTo: asEither(asString, asNumber),
    payinAddress: asString,
    payinExtraId: asOptional(asString),
    currencyFrom: asString,
    currencyTo: asString,
    payoutAddress: asString,
    payoutExtraId: asOptional(asString)
  })
})

function checkReply(
  reply: { error?: { code?: number; message?: string } },
  request: EdgeSwapRequestPlugin
): void {
  if (reply.error != null) {
    if (
      reply.error.code === -32602 ||
      (reply.error.message?.includes('Invalid currency:') ?? false)
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    throw new Error('ChangeHero error: ' + JSON.stringify(reply.error))
  }
}

// Provider data
let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60 // 1 hour

export function makeChangeHeroPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  async function call(json: any): Promise<any> {
    const body = JSON.stringify(json)

    const headers = {
      'Content-Type': 'application/json',
      'api-key': apiKey
    }
    const response = await fetchCors(uri, { method: 'POST', body, headers })

    if (!response.ok) {
      log.warn('ChangeHero response:', await response.text())
      throw new Error(`ChangeHero returned error code ${response.status}`)
    }
    return await response.json()
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const json = await call({
        jsonrpc: '2.0',
        id: 'one',
        method: 'getCurrenciesFull',
        params: {}
      })

      const assets = asChangeheroAssets(json)

      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
      const out: ChainCodeTickerMap = new Map()
      for (const asset of assets.result) {
        if (chaincodeArray.includes(asset.blockchain)) {
          const tokenCodes = out.get(asset.blockchain) ?? []
          tokenCodes.push({
            tokenCode: asset.name,
            contractAddress: asset.contractAddress
          })
          out.set(asset.blockchain, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('ChangeHero: Error updating supported assets', e)
    }
  }

  async function getFixedQuote(
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> {
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet),
      getAddress(request.toWallet)
    ])

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION
    )

    const quoteAmount =
      request.quoteFor === 'from'
        ? nativeToDenomination(
            request.fromWallet,
            request.nativeAmount,
            request.fromTokenId
          )
        : nativeToDenomination(
            request.toWallet,
            request.nativeAmount,
            request.toTokenId
          )

    const fixRate = {
      jsonrpc: '2.0',
      id: 'one',
      method: 'getFixRate',
      params: {
        from: fromCurrencyCode,
        to: toCurrencyCode,
        chainFrom: fromMainnetCode,
        chainTo: toMainnetCode
      }
    }
    const fixedRateQuote = await call(fixRate)

    checkReply(fixedRateQuote, request)

    const [
      { id: responseId, maxFrom, maxTo, minFrom, minTo }
    ] = asGetFixRateReply(fixedRateQuote).result
    const maxFromNative = denominationToNative(
      request.fromWallet,
      maxFrom,
      request.fromTokenId
    )
    const maxToNative = denominationToNative(
      request.toWallet,
      maxTo,
      request.toTokenId
    )
    const minFromNative = denominationToNative(
      request.fromWallet,
      minFrom,
      request.fromTokenId
    )
    const minToNative = denominationToNative(
      request.toWallet,
      minTo,
      request.toTokenId
    )

    if (request.quoteFor === 'from') {
      if (gt(quoteAmount, maxFrom)) {
        throw new SwapAboveLimitError(swapInfo, maxFromNative)
      }
      if (lt(quoteAmount, minFrom)) {
        throw new SwapBelowLimitError(swapInfo, minFromNative)
      }
    } else {
      if (gt(quoteAmount, maxTo)) {
        throw new SwapAboveLimitError(swapInfo, maxToNative, 'to')
      }
      if (lt(quoteAmount, minTo)) {
        throw new SwapBelowLimitError(swapInfo, minToNative, 'to')
      }
    }

    const params =
      request.quoteFor === 'from'
        ? {
            amount: quoteAmount,
            from: fromCurrencyCode,
            to: toCurrencyCode,
            chainFrom: fromMainnetCode,
            chainTo: toMainnetCode,
            address: toAddress,
            extraId: null,
            refundAddress: fromAddress,
            refundExtraId: null,
            rateId: responseId
          }
        : {
            amountTo: quoteAmount,
            from: fromCurrencyCode,
            to: toCurrencyCode,
            chainFrom: fromMainnetCode,
            chainTo: toMainnetCode,
            address: toAddress,
            extraId: null,
            refundAddress: fromAddress,
            refundExtraId: null,
            rateId: responseId
          }
    const reply = {
      jsonrpc: '2.0',
      id: 2,
      method: 'createFixTransaction',
      params
    }

    const sendReply = await call(reply)

    // NOTE: Testing showed the undocumented `chainFrom` and `chainTo` fields in sendReply are present in the response but are null.
    // Tested with mainnet currency codes in addition to the pluginIds as detailed above.

    checkReply(sendReply, request)

    const quoteInfo = asCreateFixTransactionReply(sendReply).result
    const amountExpectedFromNative = denominationToNative(
      request.fromWallet,
      `${quoteInfo.amountExpectedFrom.toString()}`,
      request.fromTokenId
    )
    const amountExpectedToNative = denominationToNative(
      request.toWallet,
      `${quoteInfo.amountExpectedTo.toString()}`,
      request.toTokenId
    )

    const memos: EdgeMemo[] =
      quoteInfo.payinExtraId == null
        ? []
        : [
            {
              type: memoType(request.fromWallet.currencyInfo.pluginId),
              value: quoteInfo.payinExtraId
            }
          ]

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: amountExpectedFromNative,
          publicAddress: quoteInfo.payinAddress
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
        orderUri: orderUri + quoteInfo.id,
        orderId: quoteInfo.id,
        isEstimate: false,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: amountExpectedToNative
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: amountExpectedFromNative
        },
        payoutAddress: toAddress,
        payoutWalletId: request.toWallet.id,
        refundAddress: fromAddress
      }
    }

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount: amountExpectedFromNative,
      expirationDate: new Date(Date.now() + expirationFixedMs)
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      // Fetch and persist chaincode/tokencode maps from provider
      await fetchSupportedAssets()

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(getFixedQuote, request)
      const swapOrder = await getFixedQuote(newRequest)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}

const asChangeheroAssets = asObject({
  result: asArray(
    asObject({
      name: asString,
      blockchain: asString,
      contractAddress: asEither(asString, asNull)
    })
  )
})
