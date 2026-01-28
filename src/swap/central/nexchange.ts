import { gt, lt } from 'biggystring'
import {
  asArray,
  asDate,
  asEither,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
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
  checkInvalidTokenIds,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
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

// Type for Nexchange currency format used when creating orders
// Supports code object for native currencies, or contract address object for tokens
type NexchangeCurrency =
  | { code: string; network: string }
  | { contract_address: string; network: string }

// See https://api.n.exchange/en/api/v2/currency/ for list of supported currencies
// Network codes map to Nexchange network identifiers
// Based on supported networks: ALGO, ATOM, SOL, BCH, BTC, DASH, DOGE, DOT, EOS, TON, HBAR, LTC, XLM, XRP, XTZ, ZEC, TRON, ADA, BASE, MATIC/POL, ETH, AVAXC, BSC, ETC, ARB, OP, FTM, SONIC
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
export const MAINNET_CODE_TRANSCRIPTION = {
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
  filecoinfevm: 'FIL',
  fio: null,
  groestlcoin: null,
  hedera: 'HBAR',
  hyperevm: 'HYPE',
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
  sui: 'SUI',
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
} as CurrencyPluginIdSwapChainCodeMap

// Helper function to get contract address from tokenId
function getContractAddress(
  wallet: EdgeCurrencyWallet,
  tokenId: string | null
): string | null {
  if (tokenId == null) return null
  const token = wallet.currencyConfig.allTokens[tokenId]
  if (token == null) {
    throw new Error(`Token not found for tokenId: ${tokenId}`)
  }
  const contractAddress = token.networkLocation?.contractAddress
  if (contractAddress == null) {
    throw new Error(`Contract address not found for token: ${tokenId}`)
  }
  return contractAddress
}

// Helper function to format currency for Nexchange API
// Returns code object format for native currencies, contract address object format for tokens
function formatCurrency(
  networkCode: string | null,
  contractAddress: string | null
): NexchangeCurrency {
  if (networkCode == null) {
    throw new Error('Network code is required')
  }

  // For native currencies (no contract address), use code object format
  if (contractAddress == null || contractAddress === '') {
    return {
      code: networkCode,
      network: networkCode
    }
  }

  // For tokens, use contract address format
  return {
    contract_address: contractAddress,
    network: networkCode
  }
}

const asRateV2 = asObject({
  // Fields validated but not currently used: pair, from, to, withdrawal_fee
  // These are kept for API validation and potential future use
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

// Cleaner for currency format in API responses
// Supports string format, code object format, or contract address object format
const asNexchangeCurrencyResponse = asEither(
  asString,
  asObject({ code: asString, network: asString }),
  asObject({ contract_address: asString, network: asString })
)

const asOrderV2 = asObject({
  unique_reference: asString,
  // Fields validated but not currently used: side, status, rate, withdraw_address, withdraw_address_extra_id,
  // refund_address, refund_address_extra_id, deposit_transaction, withdraw_transaction
  // These are kept for API validation and potential future use
  side: asString,
  withdraw_amount: asString,
  deposit_amount: asString,
  deposit_currency: asNexchangeCurrencyResponse,
  withdraw_currency: asNexchangeCurrencyResponse,
  status: asString,
  created_on: asDate,
  payment_window_minutes: asNumber,
  fixed_rate_deadline: asOptional(asDate),
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

    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error(`Nexchange returned invalid JSON: ${text}`)
    }
  }

  async function getFixedQuote(
    request: EdgeSwapRequestPlugin,
    _userSettings: Object | undefined
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

    // Get network codes from plugin IDs (contract addresses used for tokens, network codes for native currencies)
    const fromMainnetCode =
      MAINNET_CODE_TRANSCRIPTION[
        request.fromWallet.currencyInfo
          .pluginId as keyof typeof MAINNET_CODE_TRANSCRIPTION
      ]
    const toMainnetCode =
      MAINNET_CODE_TRANSCRIPTION[
        request.toWallet.currencyInfo
          .pluginId as keyof typeof MAINNET_CODE_TRANSCRIPTION
      ]

    if (fromMainnetCode == null || toMainnetCode == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Get contract addresses from tokenIds
    const fromContractAddress = getContractAddress(
      request.fromWallet,
      request.fromTokenId
    )
    const toContractAddress = getContractAddress(
      request.toWallet,
      request.toTokenId
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

    // Build rate query using API v2 recommended format:
    // For native currencies: use 'from' + 'fromNetwork' (currency code + network)
    // For tokens: use 'fromContractAddress' + 'fromNetwork' (contract address + network)
    const params = new URLSearchParams()
    if (fromContractAddress == null || fromContractAddress === '') {
      // Native currency: use code + network format
      params.append('from', fromMainnetCode)
      params.append('fromNetwork', fromMainnetCode)
    } else {
      // Token: use contract address + network format
      params.append('fromContractAddress', fromContractAddress)
      params.append('fromNetwork', fromMainnetCode)
    }
    if (toContractAddress == null || toContractAddress === '') {
      // Native currency: use code + network format
      params.append('to', toMainnetCode)
      params.append('toNetwork', toMainnetCode)
    } else {
      // Token: use contract address + network format
      params.append('toContractAddress', toContractAddress)
      params.append('toNetwork', toMainnetCode)
    }

    // Query rate using contract address format
    const rateResponse = await call(
      `${uri}/rate/?${params.toString()}`,
      {},
      request
    )
    let rates
    try {
      rates = asArray(asRateV2)(rateResponse)
    } catch (e) {
      throw new Error(`Nexchange rate response parsing failed: ${String(e)}`)
    }
    const rate = rates[0] // Contract address query returns single rate

    if (rate == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    // Check if rate is expired
    const expirationTime = parseInt(rate.expiration_time_unix, 10) * 1000
    if (Number.isNaN(expirationTime) || Date.now() >= expirationTime) {
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

    // Create order
    // BUY is the default side (buying withdraw_currency with deposit_currency)
    // For Edge: fromCurrency -> toCurrency means sending fromCurrency, receiving toCurrency
    // For Nexchange: deposit_currency = what we send, withdraw_currency = what we receive
    //
    // Use API v2 recommended format:
    // Format: { contract_address: "0x...", network: "ETH" } for tokens
    // Format: { code: "BTC", network: "BTC" } for native currencies

    // Map Edge currencies to Nexchange currencies using contract addresses
    // deposit_currency = what Edge sends = Edge fromCurrency
    // withdraw_currency = what Edge receives = Edge toCurrency
    const depositCurrency = formatCurrency(fromMainnetCode, fromContractAddress)
    const withdrawCurrency = formatCurrency(toMainnetCode, toContractAddress)

    const orderBody: {
      deposit_currency: NexchangeCurrency
      withdraw_currency: NexchangeCurrency
      withdraw_address: string
      refund_address: string
      rate_id: string
      deposit_amount?: string
      withdraw_amount?: string
    } = {
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

    let order
    try {
      order = asOrderV2(orderResponse)
    } catch (e) {
      throw new Error(`Nexchange order response parsing failed: ${String(e)}`)
    }

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
    // Use ensureInFuture to guarantee quotes have at least 30 seconds before expiring
    // Use order creation time instead of now() to account for any processing delay
    const orderCreatedTime = order.created_on.getTime()
    const defaultExpiration = new Date(
      orderCreatedTime + order.payment_window_minutes * 60 * 1000
    )
    const expirationDate: Date =
      order.fixed_rate_deadline != null
        ? ensureInFuture(order.fixed_rate_deadline) ?? defaultExpiration
        : ensureInFuture(defaultExpiration) ?? defaultExpiration

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
      opts: { promoCode?: string } // Reserved for future use
    ): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      checkInvalidTokenIds(INVALID_TOKEN_IDS, request, swapInfo)

      const newRequest = await getMaxSwappable(
        getFixedQuote,
        request,
        userSettings
      )
      const swapOrder = await getFixedQuote(newRequest, userSettings)
      return await makeSwapPluginQuote(swapOrder)
    }
  }

  return out
}
