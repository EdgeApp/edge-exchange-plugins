import { gt, lt } from 'biggystring'
import { asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSpendInfo,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTokenId,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  checkInvalidCodes,
  checkWhitelistedMainnetCodes,
  CurrencyCodeTranscriptionMap,
  getCodesWithTranscription,
  getMaxSwappable,
  InvalidCurrencyCodes,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress } from '../../util/utils'
import { asNumberString, EdgeSwapRequestPlugin } from '../types'
import { asOptionalBlank } from './changenow'

const pluginId = 'letsexchange'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'LetsExchange',
  supportEmail: 'support@letsexchange.io'
}

const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString)
})

const orderUri = 'https://letsexchange.io/?exchangeId='
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
  from: {
    ethereum: ['MATH'],
    polygon: ['USDC.e']
  },
  to: {
    ethereum: ['MATH'],
    polygon: ['USDC.e'],
    zcash: ['ZEC']
  }
}

// See https://letsexchange.io/exchange-pairs for list of supported currencies
const MAINNET_CODE_TRANSCRIPTION = {
  algorand: 'ALGO',
  arbitrum: 'ARBITRUM',
  avalanche: 'AVAXC',
  // axelar: // Shows up as WAXL from the API but is currently disabled
  // base:
  binance: 'BEP2',
  binancesmartchain: 'BEP20',
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  bitcoingold: 'BTG',
  bitcoinsv: 'BSV',
  celo: 'CELO',
  // coreum:
  cosmoshub: 'ATOM',
  dash: 'DASH',
  digibyte: 'DGB',
  dogecoin: 'DOGE',
  // eboost:
  eos: 'EOS',
  ethereum: 'ERC20',
  ethereumclassic: 'ETC',
  ethereumpow: 'ETHW',
  fantom: 'FTM',
  // feathercoin:
  filecoin: 'FIL',
  // filecoinfevm:
  fio: 'FIO',
  groestlcoin: 'GRS',
  hedera: 'HBAR',
  // liberland:
  litecoin: 'LTC',
  monero: 'XMR',
  optimism: 'OPTIMISM',
  osmosis: 'OSMO',
  piratechain: 'ARRR',
  polkadot: 'DOT',
  polygon: 'MATIC',
  pulsechain: 'PLS',
  qtum: 'QTUM',
  ravencoin: 'RVN',
  ripple: 'XRP',
  rsk: 'RSK',
  // smartcash:
  solana: 'SOL',
  stellar: 'XLM',
  telos: 'TLOS',
  tezos: 'XTZ',
  thorchainrune: 'RUNE',
  tron: 'TRC20',
  // ufo:
  // vertcoin:
  wax: 'WAX',
  zcash: 'ZEC',
  zcoin: 'FIRO',
  zksync: 'ZKSYNC'
}

const SPECIAL_MAINNET_CASES: {
  [pId: string]: Map<EdgeTokenId, string>
} = {
  // axelar: new Map([[null, 'WAXL']]), // currentlyly disabled
  binancesmartchain: new Map([[null, 'BNB']]),
  ethereum: new Map([[null, 'ETH']]),
  rsk: new Map([[null, 'RBTC']]),
  tron: new Map([[null, 'TRX']])
}

const CURRENCY_CODE_TRANSCRIPTION: CurrencyCodeTranscriptionMap = {
  optimism: {
    VELO: 'VELODROME'
  }
}

export function makeLetsExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const initOptions = asInitOptions(opts.initOptions)

  async function call(
    url: string,
    request: EdgeSwapRequestPlugin,
    data: { params: Object }
  ): Promise<Object> {
    const body = JSON.stringify(data.params)

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${initOptions.apiKey}`,
      Accept: 'application/json'
    }
    const response = await fetchCors(url, { method: 'POST', body, headers })
    if (!response.ok) {
      if (response.status === 422) {
        throw new SwapCurrencyError(swapInfo, request)
      }
      throw new Error(`letsexchange returned error code ${response.status}`)
    }
    return await response.json()
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

    const { fromMainnetCode, toMainnetCode } = getCodesWithTranscription(
      request,
      MAINNET_CODE_TRANSCRIPTION,
      CURRENCY_CODE_TRANSCRIPTION
    )

    const { pluginId: fromPluginId } = request.fromWallet.currencyInfo
    const networkFrom =
      SPECIAL_MAINNET_CASES[fromPluginId]?.get(request.fromTokenId) ??
      fromMainnetCode

    const { pluginId: toPluginId } = request.toWallet.currencyInfo
    const networkTo =
      SPECIAL_MAINNET_CASES[toPluginId]?.get(request.toTokenId) ?? toMainnetCode

    // Swap the currencies if we need a reverse quote:
    const quoteParams = {
      from: request.fromCurrencyCode,
      to: request.toCurrencyCode,
      network_from: networkFrom,
      network_to: networkTo,
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
        coin_from: request.fromCurrencyCode,
        coin_to: request.toCurrencyCode,
        network_from: networkFrom,
        network_to: networkTo,
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

    const fromNativeAmount = await request.fromWallet.denominationToNative(
      quoteInfo.deposit_amount,
      request.fromCurrencyCode
    )
    const toNativeAmount = await request.toWallet.denominationToNative(
      quoteInfo.withdrawal_amount,
      request.toCurrencyCode
    )

    // Make the transaction:
    const spendInfo: EdgeSpendInfo = {
      tokenId: request.fromTokenId,
      spendTargets: [
        {
          nativeAmount: fromNativeAmount,
          publicAddress: quoteInfo.deposit,
          uniqueIdentifier: quoteInfo.deposit_extra_id
        }
      ],
      networkFeeOption:
        request.fromCurrencyCode.toUpperCase() === 'BTC' ? 'high' : 'standard',
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
