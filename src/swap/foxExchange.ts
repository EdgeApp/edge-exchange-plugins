import {
  asBoolean,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { checkInvalidCodes, InvalidCurrencyCodes } from '../swap-helpers'

const pluginId = 'foxExchange'

const asPostResponse = asOptional(
  asObject({
    success: asOptional(asBoolean),
    code: asOptional(asString),
    error: asOptional(asString),
    data: asObject(asUnknown)
  })
)

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Fox Exchange',
  supportEmail: 'support@fox.exchange'
}

const orderUri = 'https://fox.exchange/tx/'
const uri = 'https://fox.exchange/api/cs'
const expirationMs = 1000 * 60

interface RateRequest {
  depositCoin: string
  destinationCoin: string
  depositCoinAmount?: number
  destinationCoinAmount?: number
  requestFixed: boolean
  requestDummyAddress?: boolean
}

const asRateInfo = asObject({
  rate: asEither(asNumber, asNull),
  destinationCoinAmount: asOptional(asEither(asNumber, asNull)),
  depositCoinAmount: asOptional(asEither(asNumber, asNull)),
  limitMinDepositCoin: asOptional(asNumber),
  limitMaxDepositCoin: asOptional(asNumber),
  limitMinDestinationCoin: asOptional(asNumber),
  limitMaxDestinationCoin: asOptional(asNumber),
  futureOrderId: asString,
  quoteToken: asOptional(asString),
  dummyAddress: asOptional(asString),
  validTill: asOptional(asNumber)
})

const asOrderInfo = asObject({
  orderId: asString,
  exchangeAddress: asObject({
    address: asString,
    tag: asEither(asString, asNull)
  }),
  qrCodeUrl: asString,
  expectedDepositCoinAmount: asNumber,
  expectedDestinationCoinAmount: asNumber,
  validTill: asNumber,
  frontendTimeout: asNumber
})

const INVALID_CURRENCY_CODES: InvalidCurrencyCodes = {
  from: {
    avalanche: 'allTokens',
    binancesmartchain: 'allCodes',
    celo: 'allTokens',
    ethereum: ['MATIC'],
    fantom: 'allCodes',
    polygon: 'allCodes'
  },
  to: {
    avalanche: 'allTokens',
    binancesmartchain: 'allCodes',
    celo: 'allTokens',
    ethereum: ['MATIC'],
    fantom: 'allCodes',
    polygon: 'allCodes',
    tezos: 'allCodes', // Unreliable with dummy addresses
    zcash: ['ZEC']
  }
}

const dontUseLegacy: { [cc: string]: boolean } = {
  DGB: true,
  LTC: true,
  BCH: true
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress != null && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeFoxExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io, log } = opts
  const { fetchCors = io.fetch } = io

  if (initOptions.apiKey == null) {
    throw new Error('No fox.exchange apiKey provided.')
  }
  const { apiKey } = initOptions

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      async function post(path: string, data: Object): Promise<Object> {
        log(`request to ${path}`, data)
        const body = JSON.stringify(data)
        const response = await fetchCors(`${uri}${path}`, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Key': apiKey,
            'X-User-IP': 'same_as_requester'
          }
        })

        const json = asPostResponse(await response.json())
        log(`reply to ${path} (${response.status})`, json)
        if (json == null) {
          throw new Error(`fox returned error code ${response.status}`)
        } else if (json.success === false) {
          if (
            json.code === 'invalid_symbol' ||
            json.code === 'trade_pair_disabled'
          ) {
            throw new SwapCurrencyError(
              swapInfo,
              request.fromCurrencyCode,
              request.toCurrencyCode
            )
          } else if (json.code === 'region_lock') {
            throw new SwapPermissionError(swapInfo, 'geoRestriction')
          } else if (json.code === 'min_limit_breached') {
            // TODO: Using the nativeAmount here is technically a bug,
            // since we don't know the actual limit in this case:
            throw new SwapBelowLimitError(swapInfo, request.nativeAmount)
          } else if (json.code === 'max_limit_breached') {
            // TODO: Using the nativeAmount here is technically a bug,
            // since we don't know the actual limit in this case:
            throw new SwapAboveLimitError(swapInfo, request.nativeAmount)
          }

          log.error('error:', json)
          throw new Error(
            'fox.exchange replied: ' + (json.error ?? json.code ?? '')
          )
        }

        return json.data
      }

      checkInvalidCodes(INVALID_CURRENCY_CODES, request, swapInfo)

      try {
        const rateReq: RateRequest = {
          depositCoin: request.fromCurrencyCode,
          destinationCoin: request.toCurrencyCode,
          requestFixed: true,
          requestDummyAddress: true
        }

        if (request.quoteFor === 'from') {
          rateReq.depositCoinAmount = Number(
            await request.fromWallet.nativeToDenomination(
              request.nativeAmount,
              request.fromCurrencyCode
            )
          )
        } else {
          rateReq.destinationCoinAmount = Number(
            await request.toWallet.nativeToDenomination(
              request.nativeAmount,
              request.toCurrencyCode
            )
          )
        }

        const rateResp = asRateInfo(await post('/rate', rateReq))
        let sourceAmount: number = 0
        let targetAmount: number = 0

        if (request.quoteFor === 'from') {
          if (rateResp.destinationCoinAmount != null) {
            targetAmount = rateResp.destinationCoinAmount
          } else if (
            rateReq.depositCoinAmount != null &&
            rateResp.limitMinDepositCoin != null &&
            rateReq.depositCoinAmount < rateResp.limitMinDepositCoin
          ) {
            throw new SwapBelowLimitError(
              swapInfo,
              await request.fromWallet.denominationToNative(
                String(rateResp.limitMinDepositCoin),
                request.fromCurrencyCode
              )
            )
          } else if (
            rateReq.depositCoinAmount != null &&
            rateResp.limitMaxDepositCoin != null &&
            rateReq.depositCoinAmount > rateResp.limitMaxDepositCoin
          ) {
            throw new SwapAboveLimitError(
              swapInfo,
              await request.fromWallet.denominationToNative(
                String(rateResp.limitMaxDepositCoin),
                request.fromCurrencyCode
              )
            )
          } else {
            throw new SwapCurrencyError(
              swapInfo,
              request.fromCurrencyCode,
              request.toCurrencyCode
            )
          }
        } else {
          if (rateResp.depositCoinAmount != null) {
            sourceAmount = rateResp.depositCoinAmount
          } else if (
            rateReq.destinationCoinAmount != null &&
            rateResp.limitMinDestinationCoin != null &&
            rateReq.destinationCoinAmount < rateResp.limitMinDestinationCoin
          ) {
            throw new SwapBelowLimitError(
              swapInfo,
              await request.toWallet.denominationToNative(
                String(rateResp.limitMinDestinationCoin),
                request.toCurrencyCode
              )
            )
          } else if (
            rateReq.destinationCoinAmount != null &&
            rateResp.limitMaxDestinationCoin != null &&
            rateReq.destinationCoinAmount > rateResp.limitMaxDestinationCoin
          ) {
            throw new SwapAboveLimitError(
              swapInfo,
              await request.toWallet.denominationToNative(
                String(rateResp.limitMaxDestinationCoin),
                request.toCurrencyCode
              )
            )
          } else {
            throw new SwapCurrencyError(
              swapInfo,
              request.fromCurrencyCode,
              request.toCurrencyCode
            )
          }
        }

        // Get fee by building TX to self unless server returned a dummy address
        // Note: For ETH this results in a SpendToSelfError, so instead
        // we build a TX to the null address
        const dummyAddress =
          rateResp.dummyAddress ??
          (request.fromCurrencyCode === 'ETH'
            ? '0x0000000000000000000000000000000000000000'
            : await getAddress(request.fromWallet, request.fromCurrencyCode))

        const dummyTx: EdgeTransaction = await request.fromWallet.makeSpend({
          currencyCode: request.fromCurrencyCode,
          spendTargets: [
            {
              nativeAmount:
                request.quoteFor === 'from'
                  ? request.nativeAmount
                  : await request.fromWallet.denominationToNative(
                      String(sourceAmount),
                      request.fromCurrencyCode
                    ),
              publicAddress: dummyAddress
            }
          ],
          networkFeeOption:
            request.fromCurrencyCode.toUpperCase() === 'BTC'
              ? 'high'
              : 'standard'
        })

        const destinationAddress = await getAddress(
          request.toWallet,
          request.toCurrencyCode
        )

        const quote: EdgeSwapQuote = {
          fromNativeAmount:
            request.quoteFor === 'from'
              ? request.nativeAmount
              : await request.fromWallet.denominationToNative(
                  String(sourceAmount),
                  request.fromCurrencyCode
                ),
          toNativeAmount:
            request.quoteFor === 'from'
              ? await request.toWallet.denominationToNative(
                  String(targetAmount),
                  request.toCurrencyCode
                )
              : request.nativeAmount,
          networkFee: {
            currencyCode: request.fromWallet.currencyInfo.currencyCode,
            nativeAmount:
              dummyTx.parentNetworkFee != null
                ? dummyTx.parentNetworkFee
                : dummyTx.networkFee
          },
          pluginId,
          expirationDate: new Date(
            rateResp.validTill ?? Date.now() + expirationMs
          ),
          isEstimate: rateResp.quoteToken == null,

          async approve(opts): Promise<EdgeSwapResult> {
            const orderResp = asOrderInfo(
              await post('/order', {
                depositCoin: request.fromCurrencyCode,
                destinationCoin: request.toCurrencyCode,
                depositCoinAmount:
                  rateReq.depositCoinAmount ?? rateResp.depositCoinAmount,
                destinationAddress: {
                  address: destinationAddress,
                  tag: null
                },
                futureOrderId: rateResp.futureOrderId,
                quoteToken: rateResp.quoteToken
              })
            )

            log(`transaction ID: ${orderResp.orderId}`)

            const tx: EdgeTransaction = await request.fromWallet.makeSpend({
              currencyCode: request.fromCurrencyCode,
              spendTargets: [
                {
                  nativeAmount: await request.fromWallet.denominationToNative(
                    String(orderResp.expectedDepositCoinAmount),
                    request.fromCurrencyCode
                  ),
                  publicAddress: orderResp.exchangeAddress.address,
                  uniqueIdentifier: orderResp.exchangeAddress.tag ?? undefined
                }
              ],
              metadata: opts?.metadata,
              networkFeeOption:
                request.fromCurrencyCode.toUpperCase() === 'BTC'
                  ? 'high'
                  : 'standard',
              swapData: {
                orderId: rateResp.futureOrderId,
                orderUri: orderUri + rateResp.futureOrderId,
                isEstimate: rateResp.quoteToken == null,
                payoutAddress: destinationAddress,
                payoutCurrencyCode: request.toCurrencyCode,
                payoutNativeAmount: quote.toNativeAmount,
                payoutWalletId: request.toWallet.id,
                plugin: { ...swapInfo },
                refundAddress: undefined
              }
            })

            const signedTransaction = await request.fromWallet.signTx(tx)
            const broadcastedTransaction = await request.fromWallet.broadcastTx(
              signedTransaction
            )
            await request.fromWallet.saveTx(signedTransaction)

            return {
              transaction: broadcastedTransaction,
              orderId: rateResp.futureOrderId,
              destinationAddress
            }
          },

          async close() {
            try {
              await post('/cancelQuote', {
                futureOrderId: rateResp.futureOrderId,
                quoteToken: rateResp.quoteToken
              })
            } catch (e) {
              // No error handling needed for this call
            }
          }
        }

        return quote
      } catch (e) {
        log(`exception`, e)
        throw e
      }
    }
  }

  return out
}
