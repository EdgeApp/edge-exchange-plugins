import { gt, lt } from 'biggystring'
import {
  asArray,
  asDate,
  asEither,
  asNull,
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

import { nexchange as nexchangeMapping } from '../../mappings/nexchange'
import {
  checkInvalidTokenIds,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getMaxSwappable,
  InvalidTokenIds,
  makeSwapPluginQuote,
  mapToRecord,
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

const ORDER_BASE_URL = 'https://n.exchange/order/'
const API_BASE_URL = 'https://api.n.exchange/en/api/v2'

const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {},
  to: {}
}

const addressTypeMap: StringMap = {
  zcash: 'transparentAddress'
}

// Interface for Nexchange currency format used when creating orders
// Uses contract address format for both native currencies (null/empty contract_address) and tokens
// Null/empty contract_address resolves to the network's main currency per API v2 specification
interface NexchangeCurrency {
  contract_address: string | null
  network: string
}

const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = mapToRecord(
  nexchangeMapping
)

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
// Uses contract address format for both native currencies (null contract_address) and tokens
// Null/empty contract_address resolves to the network's main currency per API v2 specification
function formatCurrency(
  networkCode: string | null,
  contractAddress: string | null
): NexchangeCurrency {
  if (networkCode == null) {
    throw new Error('Network code is required')
  }

  // For native currencies: use null contract_address (resolves to network's main currency)
  // For tokens: use actual contract address
  return {
    contract_address:
      contractAddress == null || contractAddress === ''
        ? null
        : contractAddress,
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
// contract_address can be null when the API echoes back native currency format
const asNexchangeCurrencyResponse = asEither(
  asString,
  asObject({ code: asString, network: asString }),
  asObject({ contract_address: asEither(asString, asNull), network: asString })
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

  const headers: StringMap = {
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
      headers?: StringMap
    } = {},
    request?: EdgeSwapRequestPlugin
  ): Promise<unknown> {
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

    // Build rate query using API v2 contract address format:
    // For native currencies: use empty contract_address (resolves to network's main currency)
    // For tokens: use actual contract address
    const params = new URLSearchParams()
    params.append('from_contract_address', fromContractAddress ?? '')
    params.append('from_network', fromMainnetCode)
    params.append('to_contract_address', toContractAddress ?? '')
    params.append('to_network', toMainnetCode)

    // Query rate using contract address format
    const rateResponse = await call(
      `${API_BASE_URL}/rate/?${params.toString()}`,
      {},
      request
    )
    let rates
    try {
      rates = asArray(asRateV2)(rateResponse)
    } catch (error) {
      throw new Error(
        `Nexchange rate response parsing failed: ${String(error)}`
      )
    }

    if (rates.length === 0) {
      throw new SwapCurrencyError(swapInfo, request)
    }
    const rate = rates[0]

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
    // Use contract address format for both native currencies and tokens
    // Format: { contract_address: "0x...", network: "ETH" } for tokens
    // Format: { contract_address: null, network: "BTC" } for native currencies (resolves to network's main currency)

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
      `${API_BASE_URL}/orders/`,
      {
        method: 'POST',
        body: JSON.stringify(orderBody)
      },
      request
    )

    let order
    try {
      order = asOrderV2(orderResponse)
    } catch (error) {
      throw new Error(
        `Nexchange order response parsing failed: ${String(error)}`
      )
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
        orderUri: ORDER_BASE_URL + order.unique_reference,
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
      checkWhitelistedMainnetCodes(
        MAINNET_CODE_TRANSCRIPTION,
        request,
        swapInfo
      )

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
