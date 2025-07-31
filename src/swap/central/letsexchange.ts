import { gt, lt } from 'biggystring'
import {
  asArray,
  asEither,
  asNull,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeMemo,
  EdgeSpendInfo,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTransaction,
  JsonObject,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  ChainCodeTickerMap,
  checkInvalidCodes,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  EdgeIdSwapIdMap,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeTwoPhaseSwapQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin } from '../types'
import { asOptionalBlank } from './changenow'

const pluginId = 'letsexchange'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'LetsExchange',
  supportEmail: 'support@letsexchange.io'
}

const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString)
})

const orderUri = 'https://letsexchange.io/?transactionId='
const uri = 'https://api.letsexchange.io/api/v1/'

const asQuoteInfo = asObject({
  transaction_id: asString,
  deposit_amount: asString,
  deposit: asString,
  deposit_extra_id: asOptionalBlank(asString),
  withdrawal_amount: asString,
  withdrawal_extra_id: asOptionalBlank(asString)
})

const asInfoReply = asObject({
  min_amount: asNumberString,
  max_amount: asNumberString,
  amount: asNumberString,
  fee: asNumberString,
  rate: asNumberString,
  profit: asNumberString,
  withdrawal_fee: asNumberString,
  rate_id: asString,
  rate_id_expired_at: asNumberString
})
const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {},
  to: {
    zcash: ['ZEC']
  }
}

// See https://letsexchange.io/exchange-pairs for list of supported currencies
// Or `curl -X GET 'https://api.letsexchange.io/api/v2/coins' -H 'Authorization: Bearer <your-api-key>' | jq .`
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'ALGO',
  arbitrum: 'ARBITRUM',
  avalanche: 'AVAXC',
  axelar: 'WAXL',
  base: null,
  binance: 'BEP2',
  binancesmartchain: 'BEP20',
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  bitcoingold: 'BTG',
  bitcoinsv: 'BSV',
  bobevm: null,
  cardano: 'ADA',
  celo: 'CELO',
  coreum: 'COREUM',
  cosmoshub: 'ATOM',
  dash: 'DASH',
  digibyte: 'DGB',
  dogecoin: 'DOGE',
  eboost: null,
  ecash: 'XEC',
  eos: 'EOS',
  ethereum: 'ERC20',
  ethereumclassic: 'ETC',
  ethereumpow: 'ETHW',
  fantom: 'FTM',
  feathercoin: null,
  filecoin: 'FIL',
  filecoinfevm: null,
  fio: 'FIO',
  groestlcoin: 'GRS',
  hedera: 'HBAR',
  hyperevm: 'HYPE',
  liberland: null,
  litecoin: 'LTC',
  monero: 'XMR',
  optimism: 'OPTIMISM',
  osmosis: 'OSMO',
  piratechain: 'ARRR',
  pivx: 'PIVX',
  polkadot: 'DOT',
  polygon: 'POL',
  pulsechain: 'PLS',
  qtum: 'QTUM',
  ravencoin: 'RVN',
  ripple: 'XRP',
  rsk: 'RSK',
  smartcash: null,
  solana: 'SOL',
  stellar: 'XLM',
  sui: 'SUI',
  telos: 'TLOS',
  tezos: 'XTZ',
  thorchainrune: 'RUNE',
  ton: 'TON',
  tron: 'TRC20',
  ufo: null,
  vertcoin: null,
  wax: 'WAX',
  zano: null, // 'ZANO' disabled until until it can be tested for integrated address/payment id
  zcash: 'ZEC',
  zcoin: 'FIRO',
  zksync: 'ZKSERA'
}

export const SPECIAL_MAINNET_CASES: EdgeIdSwapIdMap = new Map([
  // axelar: new Map([[null, 'WAXL']]), // currentlyly disabled
  [
    'binancesmartchain',
    new Map([[null, { chainCode: 'BNB', tokenCode: 'BNB' }]])
  ],
  ['ethereum', new Map([[null, { chainCode: 'ETH', tokenCode: 'ETH' }]])],
  ['rsk', new Map([[null, { chainCode: 'RBTC', tokenCode: 'RBTC' }]])],
  ['tron', new Map([[null, { chainCode: 'TRX', tokenCode: 'TRX' }]])],
  ['hyperevm', new Map([[null, { chainCode: 'HYPEEVM', tokenCode: 'HYPE' }]])]
])

// Provider data
let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60 // 1 hour

// Interface for storing data between quote and approval phases
interface LetsExchangeQuoteData {
  rate_id: string
  rate_id_expired_at: string
  fromAmount: string
  toAmount: string
  fromMainnetCode: string
  toMainnetCode: string
  fromCurrencyCode: string
  toCurrencyCode: string
  quoteFor: 'from' | 'to' | 'max'
  reverseQuote: boolean
  fromAddress: string
  toAddress: string
  promoCode?: string
}

export function makeLetsExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${initOptions.apiKey}`,
    Accept: 'application/json'
  }

  async function call(
    url: string,
    request: EdgeSwapRequestPlugin,
    data: { params: Object }
  ): Promise<Object> {
    const body = JSON.stringify(data.params)
    const response = await fetchCors(url, { method: 'POST', body, headers })
    if (!response.ok) {
      if (response.status === 422) {
        throw new SwapCurrencyError(swapInfo, request)
      }
      throw new Error(`letsexchange returned error code ${response.status}`)
    }
    return await response.json()
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const response = await fetchCors(
        `https://api.letsexchange.io/api/v2/coins`,
        { headers }
      )
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message)
      }
      const json = await response.json()
      const assets = asLetsExchangeAssets(json)

      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION)
      const out: ChainCodeTickerMap = new Map()
      for (const asset of assets) {
        for (const network of asset.networks) {
          if (chaincodeArray.includes(network.code)) {
            const tokenCodes = out.get(network.code) ?? []
            tokenCodes.push({
              tokenCode: asset.code,
              contractAddress: network.contract_address
            })
            out.set(network.code, tokenCodes)
          }
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('LetsExchange: Error updating supported assets', e)
    }
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin,
    opts: { promoCode?: string }
  ): Promise<SwapOrder> => {
    const reverseQuote = request.quoteFor === 'to'

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(request.fromWallet),
      getAddress(request.toWallet)
    ])

    // Convert the native amount to a denomination:
    const quoteAmount =
      request.quoteFor === 'from'
        ? await request.fromWallet.nativeToDenomination(
            request.nativeAmount,
            request.fromCurrencyCode
          )
        : await request.toWallet.nativeToDenomination(
            request.nativeAmount,
            request.toCurrencyCode
          )

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = await getChainAndTokenCodes(
      request,
      swapInfo,
      chainCodeTickerMap,
      MAINNET_CODE_TRANSCRIPTION,
      SPECIAL_MAINNET_CASES
    )

    // Build params for info endpoint
    const quoteParams = {
      from: fromCurrencyCode,
      to: toCurrencyCode,
      network_from: fromMainnetCode,
      network_to: toMainnetCode,
      amount: quoteAmount,
      float: false,
      affiliate_id: initOptions.affiliateId,
      promocode: opts.promoCode ?? ''
    }

    log('quoteParams:', quoteParams)

    // Calculate the amounts:
    let fromAmount: string = ''
    let toAmount: string = ''
    let endpoint: string
    if (request.quoteFor === 'from') {
      fromAmount = quoteAmount
      endpoint = 'info'
    } else {
      toAmount = quoteAmount
      endpoint = 'info-revert'
    }

    // ONLY call the info endpoint - no transaction creation
    const response = await call(uri + endpoint, request, {
      params: quoteParams
    })
    const reply = asInfoReply(response)

    // Check the min/max:
    const nativeMin = reverseQuote
      ? await request.toWallet.denominationToNative(
          reply.min_amount,
          request.toCurrencyCode
        )
      : await request.fromWallet.denominationToNative(
          reply.min_amount,
          request.fromCurrencyCode
        )

    if (lt(request.nativeAmount, nativeMin)) {
      throw new SwapBelowLimitError(
        swapInfo,
        nativeMin,
        reverseQuote ? 'to' : 'from'
      )
    }

    const nativeMax = reverseQuote
      ? await request.toWallet.denominationToNative(
          reply.max_amount,
          request.toCurrencyCode
        )
      : await request.fromWallet.denominationToNative(
          reply.max_amount,
          request.fromCurrencyCode
        )

    if (gt(nativeMax, '0')) {
      if (gt(request.nativeAmount, nativeMax)) {
        throw new SwapAboveLimitError(
          swapInfo,
          nativeMin,
          reverseQuote ? 'to' : 'from'
        )
      }
    }

    // Calculate amounts from the info response
    let calculatedFromAmount: string
    let calculatedToAmount: string

    if (request.quoteFor === 'from') {
      calculatedFromAmount = fromAmount
      calculatedToAmount = reply.amount
    } else {
      // For reverse quotes, the amount field contains the from amount
      calculatedFromAmount = reply.amount
      calculatedToAmount = toAmount
    }

    const fromNativeAmount = await request.fromWallet.denominationToNative(
      calculatedFromAmount,
      request.fromCurrencyCode
    )
    const toNativeAmount = await request.toWallet.denominationToNative(
      calculatedToAmount,
      request.toCurrencyCode
    )

    // Store all data needed for transaction creation in approval phase
    const pluginData: LetsExchangeQuoteData = {
      rate_id: reply.rate_id,
      rate_id_expired_at: reply.rate_id_expired_at,
      fromAmount: calculatedFromAmount,
      toAmount: calculatedToAmount,
      fromMainnetCode,
      toMainnetCode,
      fromCurrencyCode: request.fromCurrencyCode,
      toCurrencyCode: request.toCurrencyCode,
      quoteFor: request.quoteFor,
      reverseQuote,
      fromAddress,
      toAddress,
      promoCode: opts.promoCode
    }

    // Create a placeholder spendInfo for fee calculation
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: 'placeholder-will-be-replaced-on-approval'
        }
      ],
      memos: [],
      networkFeeOption: 'high',
      assetAction: {
        assetActionType: 'swap'
      },
      savedAction: {
        actionType: 'swap',
        swapInfo,
        orderId: `placeholder-${reply.rate_id}`,
        orderUri: `${orderUri}placeholder`,
        isEstimate: true,
        toAsset: {
          pluginId: request.toWallet.currencyInfo.pluginId,
          tokenId: request.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: request.fromWallet.currencyInfo.pluginId,
          tokenId: request.fromTokenId,
          nativeAmount: fromNativeAmount
        },
        payoutAddress: toAddress,
        payoutWalletId: request.toWallet.id,
        refundAddress: fromAddress
      }
    }

    log('Quote created with rate_id:', reply.rate_id)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      pluginData: pluginData as JsonObject,
      expirationDate: new Date(parseInt(reply.rate_id_expired_at))
    }
  }

  // Create real transaction when user approves the quote
  const createSwapTransaction = async (
    quote: EdgeSwapQuote,
    request: EdgeSwapRequest,
    opts?: EdgeSwapApproveOptions
  ): Promise<EdgeTransaction> => {
    // Type guard to ensure we have the right request type
    const swapRequest = convertRequest(request)
    const data = quote.pluginData as LetsExchangeQuoteData | undefined

    if (data == null) {
      throw new Error('Missing quote data for transaction creation')
    }

    // Check if rate is still valid
    if (Date.now() > parseInt(data.rate_id_expired_at)) {
      throw new Error('Quote has expired')
    }

    // Create the real transaction now
    const endpoint = data.reverseQuote ? 'transaction-revert' : 'transaction'
    const sendReply = await call(uri + endpoint, swapRequest, {
      params: {
        deposit_amount: data.reverseQuote ? undefined : data.fromAmount,
        withdrawal_amount: data.reverseQuote ? data.toAmount : undefined,
        coin_from: data.fromCurrencyCode,
        coin_to: data.toCurrencyCode,
        network_from: data.fromMainnetCode,
        network_to: data.toMainnetCode,
        withdrawal: data.toAddress,
        return: data.fromAddress,
        return_extra_id: null,
        withdrawal_extra_id: null,
        affiliate_id: initOptions.affiliateId,
        promocode: data.promoCode ?? '',
        type: 'edge',
        float: false,
        isEstimate: false,
        rate_id: data.rate_id
      }
    })

    log('Transaction created:', sendReply)
    const quoteInfo = asQuoteInfo(sendReply)

    const fromNativeAmount = await swapRequest.fromWallet.denominationToNative(
      quoteInfo.deposit_amount,
      swapRequest.fromCurrencyCode
    )
    const toNativeAmount = await swapRequest.toWallet.denominationToNative(
      quoteInfo.withdrawal_amount,
      swapRequest.toCurrencyCode
    )

    const memos: EdgeMemo[] =
      quoteInfo.deposit_extra_id == null
        ? []
        : [
            {
              type: memoType(swapRequest.fromWallet.currencyInfo.pluginId),
              value: quoteInfo.deposit_extra_id
            }
          ]

    // Create the real transaction
    const spendInfo: EdgeSpendInfo = {
      tokenId: swapRequest.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteInfo.deposit
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
        orderId: quoteInfo.transaction_id,
        orderUri: `${orderUri}${quoteInfo.transaction_id}`,
        isEstimate: false,
        toAsset: {
          pluginId: swapRequest.toWallet.currencyInfo.pluginId,
          tokenId: swapRequest.toTokenId,
          nativeAmount: toNativeAmount
        },
        fromAsset: {
          pluginId: swapRequest.fromWallet.currencyInfo.pluginId,
          tokenId: swapRequest.fromTokenId,
          nativeAmount: fromNativeAmount
        },
        payoutAddress: data.toAddress,
        payoutWalletId: swapRequest.toWallet.id,
        refundAddress: data.fromAddress
      }
    }

    // Create and return the transaction
    const tx = await swapRequest.fromWallet.makeSpend(spendInfo)
    return tx
  }

  const plugin: EdgeSwapPlugin & {
    createSwapTransaction: typeof createSwapTransaction
  } = {
    swapInfo,

    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      // Fetch and persist chaincode/tokencode maps from provider
      await fetchSupportedAssets()

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

      const newRequest = await getMaxSwappable(
        fetchSwapQuoteInner,
        request,
        opts
      )
      const swapOrder = await fetchSwapQuoteInner(newRequest, opts)
      return await makeTwoPhaseSwapQuote(swapOrder, plugin)
    },

    createSwapTransaction
  }

  const out: EdgeSwapPlugin = plugin

  return out
}

const asLetsExchangeAssets = asArray(
  asObject({
    code: asString,
    networks: asArray(
      asObject({
        code: asString,
        contract_address: asEither(asString, asNull)
      })
    )
  })
)
