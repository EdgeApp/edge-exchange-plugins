import { add, floor, gt, gte, mul, sub } from 'biggystring'
import {
  asDate,
  asMaybe,
  asNumber,
  asObject,
  asString,
  Cleaner
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

import { div18 } from '../../util/biggystringplus'
import {
  checkInvalidCodes,
  checkWhitelistedMainnetCodes,
  CurrencyPluginIdSwapChainCodeMap,
  ensureInFuture,
  getCodesWithTranscription,
  getMaxSwappable,
  InvalidCurrencyCodes,
  isLikeKind,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress, memoType } from '../../util/utils'
import { EdgeSwapRequestPlugin } from '../types'

const pluginId = 'swapuz'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: 'Swapuz',
  supportEmail: 'support@swapuz.com'
}

const asInitOptions = asObject({
  apiKey: asString
})

const orderUri = 'https://swapuz.com/order/'
const uri = 'https://api.swapuz.com/api/home/v1/'

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    ethereum: ['MATH'],
    optimism: ['VELO'],
    polygon: ['USDC', 'USDC.e']
  },
  to: {
    ethereum: ['MATH'],
    polygon: ['USDC', 'USDC.e'],
    zcash: ['ZEC'],
    zksync: 'allCodes'
  }
}

// Network names that don't match parent network currency code
// See https://swapuz.com/ for list of supported currencies
const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  algorand: 'ALGO',
  arbitrum: 'ARBITRUM',
  avalanche: 'CCHAIN',
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
  celo: 'CELO',
  coreum: null,
  cosmoshub: 'ATOM',
  dash: 'DASH',
  digibyte: 'DGB',
  dogecoin: 'DOGE',
  eboost: null,
  ecash: 'XEC',
  eos: 'EOS',
  ethereum: 'ETH',
  ethereumclassic: 'ETC',
  ethereumpow: null,
  fantom: 'FTM',
  feathercoin: null,
  filecoin: 'FIL',
  filecoinfevm: null,
  fio: null,
  groestlcoin: null,
  hedera: 'HBAR',
  hyperevm: null,
  liberland: null,
  litecoin: 'LTC',
  monero: 'XMR',
  optimism: 'OPTIMISM',
  osmosis: null,
  piratechain: null,
  pivx: null,
  polkadot: 'DOT',
  polygon: 'MATIC',
  pulsechain: null,
  qtum: 'QTUM',
  ravencoin: 'RVN',
  ripple: 'XRP',
  rsk: null,
  smartcash: null,
  solana: 'SOL',
  sonic: null,
  stellar: 'XLM',
  sui: 'SUI',
  telos: null,
  tezos: 'XTZ',
  thorchainrune: 'THORCHAIN',
  ton: 'TON',
  tron: 'TRX',
  ufo: null,
  vertcoin: null,
  wax: 'WAXP',
  zano: null,
  zcash: 'ZEC',
  zcoin: null,
  zksync: null
}

export function makeSwapuzPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const { io } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  const headers = {
    'Content-Type': 'application/json',
    'api-key': apiKey
  }

  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const { fromWallet, toWallet } = request

    checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)
    checkWhitelistedMainnetCodes(MAINNET_CODE_TRANSCRIPTION, request, swapInfo)

    // Grab addresses:
    const [fromAddress, toAddress] = await Promise.all([
      getAddress(fromWallet),
      getAddress(toWallet)
    ])

    const {
      fromCurrencyCode,
      toCurrencyCode,
      fromMainnetCode,
      toMainnetCode
    } = getCodesWithTranscription(request, MAINNET_CODE_TRANSCRIPTION)

    const getQuote = async (mode: 'fix' | 'float'): Promise<SwapOrder> => {
      const { nativeAmount } = request

      const largeDenomAmount = await fromWallet.nativeToDenomination(
        nativeAmount,
        fromCurrencyCode
      )

      const getRateResponse = await fetchCors(
        uri +
          `rate/?mode=${mode}&amount=${largeDenomAmount}&from=${fromCurrencyCode}&to=${toCurrencyCode}&fromNetwork=${fromMainnetCode}&toNetwork=${toMainnetCode}`,
        { headers }
      )
      if (!getRateResponse.ok) {
        const json = await getRateResponse.json()
        if (
          json.message?.includes(
            'Amount to exchange is below the possible min amount to exchange'
          ) === true
        ) {
          // Extract the required minimum amount from the error message
          const requiredMatch = json.message.match(/required ([0-9.]+)/)
          if (requiredMatch?.[1] != null) {
            const minAmount = requiredMatch[1]
            const nativeMin = await fromWallet.denominationToNative(
              minAmount,
              fromCurrencyCode
            )
            throw new SwapBelowLimitError(swapInfo, nativeMin)
          }
          // Fallback if we can't extract the minimum amount
          throw new SwapBelowLimitError(
            swapInfo,
            undefined,
            request.quoteFor === 'to' ? 'to' : 'from'
          )
        }
        throw new Error(
          `Swapuz call returned error code ${getRateResponse.status}`
        )
      }

      const getRateJson = asApiResponse(asGetRate)(await getRateResponse.json())

      if (getRateJson.result == null)
        throw new SwapCurrencyError(swapInfo, request)

      const { minAmount } = getRateJson.result

      if (gt(minAmount.toString(), largeDenomAmount)) {
        const nativeMinAmount = await fromWallet.denominationToNative(
          minAmount.toString(),
          fromCurrencyCode
        )
        throw new SwapBelowLimitError(swapInfo, nativeMinAmount)
      }

      // Create order
      const orderBody = {
        from: fromCurrencyCode,
        fromNetwork: fromMainnetCode,
        to: toCurrencyCode,
        toNetwork: toMainnetCode,
        address: toAddress,
        amount: parseFloat(largeDenomAmount),
        mode,
        addressUserFrom: fromAddress,
        addressRefund: fromAddress
      }

      const createOrderResponse = await fetchCors(uri + 'order', {
        method: 'POST',
        body: JSON.stringify(orderBody),
        headers
      })
      if (!createOrderResponse.ok) {
        const text = await createOrderResponse.text()

        // Check if the text is actually an above limit error ie. 'create order: BTC -> BCH amount > maxAmount  = 0.00916125 > 0.0091614959183703384476468148'
        const textArray = text.split(' ')
        if (textArray[7] === 'maxAmount' && !isNaN(parseFloat(textArray[12]))) {
          const nativeMaxAmount = floor(
            await fromWallet.denominationToNative(
              textArray[12],
              fromCurrencyCode
            ),
            0
          )
          throw new SwapAboveLimitError(swapInfo, nativeMaxAmount)
        }

        throw new Error(
          `Swapuz call returned error code ${createOrderResponse.status}\n${text}`
        )
      }

      const createOrderJson = asApiResponse(asCreateOrder)(
        await createOrderResponse.json()
      )

      if (createOrderJson.result == null) {
        throw new SwapCurrencyError(swapInfo, request)
      }

      const {
        addressFrom,
        finishPayment,
        amountResult,
        uid,
        memoFrom
      } = createOrderJson.result

      const toNativeAmount = floor(
        await toWallet.denominationToNative(
          amountResult.toString(),
          toCurrencyCode
        ),
        0
      )

      const memos: EdgeMemo[] =
        memoFrom == null
          ? []
          : [
              {
                type: memoType(request.fromWallet.currencyInfo.pluginId),
                value: memoFrom
              }
            ]

      const spendInfo: EdgeSpendInfo = {
        tokenId: request.fromTokenId,
        spendTargets: [
          {
            nativeAmount: request.nativeAmount,
            publicAddress: addressFrom
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
          orderId: uid,
          orderUri: orderUri + uid,
          isEstimate: mode === 'float',
          toAsset: {
            pluginId: request.toWallet.currencyInfo.pluginId,
            tokenId: request.toTokenId,
            nativeAmount: toNativeAmount
          },
          fromAsset: {
            pluginId: request.fromWallet.currencyInfo.pluginId,
            tokenId: request.fromTokenId,
            nativeAmount: request.nativeAmount
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
        fromNativeAmount: request.nativeAmount,
        expirationDate: ensureInFuture(finishPayment)
      }
    }

    // Try them all
    try {
      return await getQuote('fix')
    } catch (e) {
      try {
        return await getQuote('float')
      } catch (e2) {
        // Should throw the fixed-rate error
        throw e
      }
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const requestTop = convertRequest(req)
      const {
        fromCurrencyCode,
        toWallet,
        toCurrencyCode,
        nativeAmount,
        quoteFor
      } = requestTop

      if (quoteFor !== 'to') {
        const newRequest = await getMaxSwappable(
          fetchSwapQuoteInner,
          requestTop
        )
        const swapOrder = await fetchSwapQuoteInner(newRequest)
        return await makeSwapPluginQuote(swapOrder)
      } else {
        // Exit early if trade isn't like kind assets
        if (!isLikeKind(fromCurrencyCode, toCurrencyCode)) {
          throw new SwapCurrencyError(swapInfo, requestTop)
        }
        // Must make a copy of the request because this is a shared object
        // reused between requests to other exchange plugins
        const requestToHack = { ...requestTop }
        const requestToExchangeAmount = await toWallet.nativeToDenomination(
          nativeAmount,
          toCurrencyCode
        )
        let fromQuoteNativeAmount = nativeAmount
        let retries = 5
        while (--retries !== 0) {
          requestToHack.nativeAmount = fromQuoteNativeAmount
          const swapOrder = await fetchSwapQuoteInner(requestToHack)
          if (!('spendInfo' in swapOrder)) break
          if (swapOrder.spendInfo.savedAction?.actionType !== 'swap') {
            throw new Error(
              `Swapuz: Invalid action type ${String(
                swapOrder.spendInfo.savedAction?.actionType
              )}`
            )
          }
          const destNativeAmount =
            swapOrder.spendInfo.savedAction?.toAsset.nativeAmount
          if (destNativeAmount == null) break

          const toExchangeAmount = await toWallet.nativeToDenomination(
            destNativeAmount,
            toCurrencyCode
          )
          if (gte(toExchangeAmount, requestToExchangeAmount)) {
            return await makeSwapPluginQuote(swapOrder)
          } else {
            // Get the % difference between the FROM and TO amounts and increase the FROM amount
            // by that %
            const diff = sub(requestToExchangeAmount, toExchangeAmount)
            const percentDiff = div18(diff, requestToExchangeAmount)
            const diffMultiplier = add('1.001', percentDiff)
            fromQuoteNativeAmount = mul(diffMultiplier, fromQuoteNativeAmount)
          }
        }
        throw new SwapCurrencyError(swapInfo, requestTop)
      }
    }
  }
  return out
}

interface ApiResponse<T> {
  result: T | undefined
  status: number
}

const asApiResponse = <T>(cleaner: Cleaner<T>): Cleaner<ApiResponse<T>> =>
  asObject({
    result: asMaybe(cleaner),
    status: asNumber
  })

const asGetRate = asObject({
  // result: asNumber,
  // amount: asNumber,
  // rate: asNumber,
  // withdrawFee: asNumber,
  minAmount: asNumber
})

// const asNetwork = asObject({
//   shortName: asString,
//   isDeposit: asBoolean,
//   isWithdraw: asBoolean,
//   isMemo: asBoolean,
//   isActive: asBoolean
// })

const asCreateOrder = asObject({
  uid: asString,
  // from: asObject({
  //   shortName: asString,
  //   isMemo: asBoolean,
  //   isDeposit: asBoolean,
  //   isWithdraw: asBoolean,
  //   network: asArray(asNetwork)
  // }),
  // to: asObject({
  //   shortName: asString,
  //   isMemo: asBoolean,
  //   isDeposit: asBoolean,
  //   isWithdraw: asBoolean,
  //   network: asArray(asNetwork)
  // }),
  amount: asNumber,
  amountResult: asNumber,
  addressFrom: asString,
  addressTo: asString,
  // addressFromNetwork: asMaybe(asString),
  // addressToNetwork: asString,
  memoFrom: asMaybe(asString),
  // memoTo: asMaybe(asString),
  // createDate: asString,
  finishPayment: asDate
})
