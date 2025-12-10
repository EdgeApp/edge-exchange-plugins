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
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidTokenIds,
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
import { EdgeSwapRequestPlugin, StringMap } from '../types'

const pluginId = 'nexchange'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'n.exchange',
  supportEmail: 'support@n.exchange'
}

const asInitOptions = asObject({
  apiKey: asString,
  referralCode: asString
})

const orderUri = 'https://n.exchange/order/'
const uri = 'https://api.n.exchange/en/api/v2'

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

// See https://api.n.exchange/en/api/v2/currency/ for list of supported currencies
// Network codes map to Nexchange network identifiers
// Based on supported networks: ALGO, ATOM, SOL, BCH, BTC, DASH, DOGE, DOT, EOS, TON, HBAR, LTC, XLM, XMR, XRP, XTZ, ZEC, TRON, ADA, BASE, MATIC/POL, ETH, AVAXC, BSC, ETC, ARB, OP, FTM, SONIC
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'ALGO',
  arbitrum: 'ARB',
  avalanche: 'AVAXC',
  axelar: null,
  base: 'BASE',
  binance: null,
  binancesmartchain: 'BSC',
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  bitcoingold: null,
  bitcoinsv: null,
  bobevm: null,
  cardano: 'ADA',
  celo: null,
  coreum: null,
  cosmoshub: 'ATOM',
  dash: 'DASH',
  digibyte: null,
  dogecoin: 'DOGE',
  eboost: null,
  ecash: null,
  eos: 'EOS',
  ethereum: 'ETH',
  ethereumclassic: 'ETC',
  ethereumpow: null,
  fantom: 'FTM',
  feathercoin: null,
  filecoin: null,
  filecoinfevm: null,
  fio: null,
  groestlcoin: null,
  hedera: 'HBAR',
  hyperevm: null,
  liberland: null,
  litecoin: 'LTC',
  monero: 'XMR',
  optimism: 'OP',
  osmosis: null,
  piratechain: null,
  pivx: null,
  polkadot: 'DOT',
  polygon: 'POL', // Nexchange uses POL for Polygon
  pulsechain: null,
  qtum: null,
  ravencoin: null,
  ripple: 'XRP',
  rsk: null,
  smartcash: null,
  solana: 'SOL',
  sonic: 'SONIC',
  stellar: 'XLM',
  sui: null,
  telos: null,
  tezos: 'XTZ',
  thorchainrune: null,
  ton: 'TON',
  tron: 'TRON',
  ufo: null,
  vertcoin: null,
  wax: null,
  zano: null,
  zcash: 'ZEC',
  zcoin: null,
  zksync: null
}

// Helper function to format currency for Nexchange API
// Supports both string format ("USDTERC") and object format ({"code": "USDT", "network": "ETH"})
function formatCurrency(
  currencyCode: string,
  networkCode: string | null
): string | { code: string; network: string } {
  // If network is null or matches the currency code (native currency), return just the code
  if (networkCode == null || networkCode === currencyCode) {
    return currencyCode
  }

  // For tokens on networks, use object format
  return {
    code: currencyCode,
    network: networkCode
  }
}

const asRateV2 = asObject({
  pair: asString,
  from: asString,
  to: asString,
  withdrawal_fee: asString,
  rate: asString,
  rate_id: asString,
  max_withdraw_amount: asString,
  min_withdraw_amount: asString,
  max_deposit_amount: asString,
  min_deposit_amount: asString,
  expiration_time_unix: asString
})

const asOrderV2 = asObject({
  unique_reference: asString,
  side: asString,
  withdraw_amount: asString,
  deposit_amount: asString,
  deposit_currency: asEither(
    asString,
    asObject({ code: asString, network: asString })
  ),
  withdraw_currency: asEither(
    asString,
    asObject({ code: asString, network: asString })
  ),
  status: asString,
  created_on: asString,
  payment_window_minutes: asNumber,
  fixed_rate_deadline: asOptional(asString),
  rate: asOptional(asString),
  deposit_address: asString,
  deposit_address_extra_id: asOptional(asString),
  withdraw_address: asOptional(asString),
  withdraw_address_extra_id: asOptional(asString),
  refund_address: asOptional(asString),
  refund_address_extra_id: asOptional(asString),
  deposit_transaction: asOptional(asString),
  withdraw_transaction: asOptional(asString)
})

// Provider data
let chainCodeTickerMap: ChainCodeTickerMap = new Map()
let lastUpdated = 0
const EXPIRATION = 1000 * 60 * 60 // 1 hour

export function makeNexchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey, referralCode } = asInitOptions(opts.initOptions)

  const headers: { [key: string]: string } = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `ApiKey ${apiKey}`,
    'x-referral-token': referralCode
  }

  async function call(
    url: string,
    options: {
      method?: string
      body?: string
      headers?: { [key: string]: string }
    } = {},
    request?: EdgeSwapRequestPlugin
  ): Promise<any> {
    const response = await fetchCors(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers ?? {})
      }
    })

    if (!response.ok) {
      const text = await response.text()
      log.warn('Nexchange response:', text)
      if (
        (response.status === 400 || response.status === 404) &&
        request != null
      ) {
        throw new SwapCurrencyError(swapInfo, request)
      }
      const errorMessage = `Nexchange returned error code ${response.status}: ${text}`
      throw new Error(errorMessage)
    }

    return await response.json()
  }

  async function fetchSupportedAssets(): Promise<void> {
    if (lastUpdated > Date.now() - EXPIRATION) return

    try {
      const currencies = await call(`${uri}/currency/`, {}, undefined)
      const assets = asArray(
        asObject({
          code: asString,
          network: asOptional(asString),
          contract_address: asOptional(asEither(asString, asNull))
        })
      )(currencies)

      const chaincodeArray = Object.values(MAINNET_CODE_TRANSCRIPTION).filter(
        (code): code is string => code != null
      )
      const out: ChainCodeTickerMap = new Map()
      for (const asset of assets) {
        const network = asset.network ?? asset.code
        if (chaincodeArray.includes(network)) {
          const tokenCodes = out.get(network) ?? []
          tokenCodes.push({
            tokenCode: asset.code,
            contractAddress: asset.contract_address ?? null
          })
          out.set(network, tokenCodes)
        }
      }

      chainCodeTickerMap = out
      lastUpdated = Date.now()
    } catch (e) {
      log.warn('Nexchange: Error updating supported assets', e)
    }
  }

  async function getFixedQuote(
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> {
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(
        request.fromWallet,
        addressTypeMap[request.fromWallet.currencyInfo.pluginId]
      ),
      getAddress(
        request.toWallet,
        addressTypeMap[request.toWallet.currencyInfo.pluginId]
      )
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

    // Build pair name for rate lookup
    // Pair format: "TOFROM" where TO is what you receive, FROM is what you send
    // Example: Buy USDC with BTC -> USDCBTC (receive USDC, send BTC)
    // Example: Sell USDC for BTC -> BTCUSDC (receive BTC, send USDC)
    const pairName = `${toCurrencyCode}${fromCurrencyCode}`

    // Get rate information
    const rateResponse = await call(
      `${uri}/rate/?pairs=${pairName}`,
      {},
      request
    )
    const rates = asArray(asRateV2)(rateResponse)
    const rate = rates.find(
      r => r.from === fromCurrencyCode && r.to === toCurrencyCode
    )

    if (rate == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Check if rate is expired
    const expirationTime = parseInt(rate.expiration_time_unix, 10) * 1000
    if (Date.now() >= expirationTime) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Check min/max limits based on quote direction
    if (request.quoteFor === 'from') {
      // We're quoting based on deposit amount (what we send)
      const maxFromNative = denominationToNative(
        request.fromWallet,
        rate.max_deposit_amount,
        request.fromTokenId
      )
      const minFromNative = denominationToNative(
        request.fromWallet,
        rate.min_deposit_amount,
        request.fromTokenId
      )

      if (gt(quoteAmount, rate.max_deposit_amount)) {
        throw new SwapAboveLimitError(swapInfo, maxFromNative)
      }
      if (lt(quoteAmount, rate.min_deposit_amount)) {
        throw new SwapBelowLimitError(swapInfo, minFromNative)
      }
    } else {
      // We're quoting based on withdraw amount (what we receive)
      const maxToNative = denominationToNative(
        request.toWallet,
        rate.max_withdraw_amount,
        request.toTokenId
      )
      const minToNative = denominationToNative(
        request.toWallet,
        rate.min_withdraw_amount,
        request.toTokenId
      )

      if (gt(quoteAmount, rate.max_withdraw_amount)) {
        throw new SwapAboveLimitError(swapInfo, maxToNative, 'to')
      }
      if (lt(quoteAmount, rate.min_withdraw_amount)) {
        throw new SwapBelowLimitError(swapInfo, minToNative, 'to')
      }
    }

    // Create order - always use BUY side
    // BUY = buying withdraw_currency with deposit_currency (sending deposit_currency, receiving withdraw_currency)
    // For Edge: fromCurrency -> toCurrency means sending fromCurrency, receiving toCurrency
    // For Nexchange: deposit_currency = what we send, withdraw_currency = what we receive
    // Pair format: TOFROM (receive TO, send FROM) - always use BUY side
    const orderSide = 'BUY'

    // Map Edge currencies to Nexchange currencies
    // deposit_currency = what Edge sends = Edge fromCurrency
    // withdraw_currency = what Edge receives = Edge toCurrency
    const depositCurrency = formatCurrency(fromCurrencyCode, fromMainnetCode)
    const withdrawCurrency = formatCurrency(toCurrencyCode, toMainnetCode)

    const orderBody: {
      side: string
      deposit_currency: string | { code: string; network: string }
      withdraw_currency: string | { code: string; network: string }
      withdraw_address: string
      refund_address: string
      rate_id: string
      deposit_amount?: string
      withdraw_amount?: string
    } = {
      side: orderSide,
      deposit_currency: depositCurrency,
      withdraw_currency: withdrawCurrency,
      withdraw_address: toAddress,
      refund_address: fromAddress,
      rate_id: rate.rate_id
    }

    // Set amount based on quote direction
    if (request.quoteFor === 'from') {
      // We know the deposit amount (what we're sending)
      orderBody.deposit_amount = quoteAmount
    } else {
      // We know the withdraw amount (what we want to receive)
      orderBody.withdraw_amount = quoteAmount
    }

    const orderResponse = await call(
      `${uri}/orders/`,
      {
        method: 'POST',
        body: JSON.stringify(orderBody)
      },
      request
    )

    const order = asOrderV2(orderResponse)

    // Calculate amounts
    const amountExpectedFromNative = denominationToNative(
      request.fromWallet,
      order.deposit_amount,
      request.fromTokenId
    )
    const amountExpectedToNative = denominationToNative(
      request.toWallet,
      order.withdraw_amount,
      request.toTokenId
    )

    const memos: EdgeMemo[] =
      order.deposit_address_extra_id == null ||
      order.deposit_address_extra_id === ''
        ? []
        : [
            {
              type: memoType(request.fromWallet.currencyInfo.pluginId),
              value: order.deposit_address_extra_id
            }
          ]

    // Calculate expiration date from fixed_rate_deadline or use default
    let expirationDate: Date
    if (order.fixed_rate_deadline != null) {
      expirationDate = new Date(order.fixed_rate_deadline)
    } else {
      expirationDate = new Date(
        Date.now() + order.payment_window_minutes * 60 * 1000
      )
    }

    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: amountExpectedFromNative,
          publicAddress: order.deposit_address
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
        orderUri: orderUri + order.unique_reference,
        orderId: order.unique_reference,
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
      expirationDate
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,
    async fetchSwapQuote(
      req: EdgeSwapRequest,
      userSettings: Object | undefined,
      opts: { promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      // Fetch and persist chaincode/tokencode maps from provider
      await fetchSupportedAssets()

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)
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
