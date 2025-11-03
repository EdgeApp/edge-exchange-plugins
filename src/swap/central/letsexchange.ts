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
  EdgeIdSwapIdMap,
  getChainAndTokenCodes,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
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

const expirationMs = 1000 * 60

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
  amount: asNumberString
})
const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: { zcash: ['ZEC'] },
  to: { zcash: ['ZEC'] }
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
  sonic: 'SONIC',
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
  zano: 'ZANO',
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

// Hedera accounts are considered activated when the address is a numeric account ID
// format: 0.0.<digits>
const isHederaActivatedAddress = (address: string): boolean =>
  /^0\.0\.\d+$/.test(address)

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
      const message = await response.text()
      if (response.status === 422) {
        throw new SwapCurrencyError(swapInfo, request)
      }
      throw new Error(
        `letsexchange returned error code ${response.status}: ${message}`
      )
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

    // HBAR support: Disable if the "to" wallet is not yet activated, pending
    // support from LetsExchange.
    if (request.toWallet.currencyInfo.pluginId === 'hedera') {
      if (!isHederaActivatedAddress(toAddress)) {
        throw new SwapCurrencyError(swapInfo, request)
      }
    }

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

    // Swap the currencies if we need a reverse quote:
    const quoteParams = {
      from: fromCurrencyCode,
      to: toCurrencyCode,
      network_from: fromMainnetCode,
      network_to: toMainnetCode,
      amount: quoteAmount
    }

    log('quoteParams:', quoteParams)

    // Calculate the amounts:
    let fromAmount, toAmount, endpoint
    if (request.quoteFor === 'from') {
      fromAmount = quoteAmount
      endpoint = 'info'
    } else {
      toAmount = quoteAmount
      endpoint = 'info-revert'
    }
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

    const { promoCode } = opts
    endpoint = reverseQuote ? 'transaction-revert' : 'transaction'
    const sendReply = await call(uri + endpoint, request, {
      params: {
        deposit_amount: reverseQuote ? undefined : fromAmount,
        withdrawal_amount: reverseQuote ? toAmount : undefined,
        coin_from: fromCurrencyCode,
        coin_to: toCurrencyCode,
        network_from: fromMainnetCode,
        network_to: toMainnetCode,
        withdrawal: toAddress,
        return: fromAddress,
        return_extra_id: null,
        withdrawal_extra_id: null,
        affiliate_id: initOptions.affiliateId,
        promocode: promoCode != null ? promoCode : '',
        type: 'edge',
        float: false,
        isEstimate: false
      }
    })

    log('sendReply', sendReply)
    const quoteInfo = asQuoteInfo(sendReply)

    const rawFromNativeAmount = await request.fromWallet.denominationToNative(
      quoteInfo.deposit_amount,
      request.fromCurrencyCode
    )
    const rawToNativeAmount = await request.toWallet.denominationToNative(
      quoteInfo.withdrawal_amount,
      request.toCurrencyCode
    )
    const fromNativeAmount = rawFromNativeAmount.split('.')[0]
    const toNativeAmount = rawToNativeAmount.split('.')[0]

    const memos: EdgeMemo[] =
      quoteInfo.deposit_extra_id == null
        ? []
        : [
            {
              type: memoType(request.fromWallet.currencyInfo.pluginId),
              value: quoteInfo.deposit_extra_id
            }
          ]

    // Make the transaction:
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
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
        orderUri: orderUri + quoteInfo.transaction_id,
        isEstimate: false,
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

    log('spendInfo', spendInfo)

    return {
      request,
      spendInfo,
      swapInfo,
      fromNativeAmount,
      expirationDate: new Date(Date.now() + expirationMs)
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
      return await makeSwapPluginQuote(swapOrder)
    }
  }

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
