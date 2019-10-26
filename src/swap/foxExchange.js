// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyWallet,
  type EdgeSwapPlugin,
  type EdgeSwapPluginQuote,
  type EdgeSwapRequest,
  type EdgeTransaction,
  SwapAboveLimitError,
  SwapBelowLimitError,
  SwapCurrencyError,
  SwapPermissionError
} from 'edge-core-js/types'

import { getFetchJson } from '../react-native-io.js'

const swapInfo = {
  pluginName: 'foxExchange',
  displayName: 'Fox Exchange',

  quoteUri: 'https://fox.exchange/tx/',
  supportEmail: 'support@fox.exchange'
}

const uri = 'https://fox.exchange/api/cs'
const expirationMs = 1000 * 60 * 20

type RateRequest = {
  depositCoin: string,
  destinationCoin: string,
  depositCoinAmount?: number,
  destinationCoinAmount?: number,
  requestFixed: boolean,
  requestDummyAddress?: boolean
}

type RateInfo = {
  rate: number | null,
  destinationCoinAmount?: number | null,
  depositCoinAmount?: number | null,
  limitMinDepositCoin?: number,
  limitMaxDepositCoin?: number,
  limitMinDestinationCoin?: number,
  limitMaxDestinationCoin?: number,
  futureOrderId: string,
  quoteToken?: string,
  dummyAddress?: string,
  validTill?: number
}

type OrderInfo = {
  orderId: string,
  exchangeAddress: {
    address: string,
    tag: string | null
  },
  qrCodeUrl: string,
  expectedDepositCoinAmount: number,
  expectedDestinationCoinAmount: number,
  validTill: number,
  frontendTimeout: number
}

const dontUseLegacy = {
  DGB: true,
  LTC: true,
  BCH: true
}

async function getAddress(
  wallet: EdgeCurrencyWallet,
  currencyCode: string
): Promise<string> {
  const addressInfo = await wallet.getReceiveAddress({ currencyCode })
  return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
    ? addressInfo.legacyAddress
    : addressInfo.publicAddress
}

export function makeFoxExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const { initOptions, io } = opts
  const fetchJson = getFetchJson(opts)

  if (initOptions.apiKey == null) {
    throw new Error('No fox.exchange apiKey provided.')
  }
  const { apiKey } = initOptions

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: Object | void
    ): Promise<EdgeSwapPluginQuote> {
      async function post(path: string, data: Object) {
        io.console.info(`fox request to ${path}`, data)
        const body = JSON.stringify(data)
        const reply = await fetchJson(`${uri}${path}`, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Key': apiKey,
            'X-User-IP': 'same_as_requester'
          }
        })

        const json = reply.json
        io.console.info(`fox reply to ${path} (${reply.status})`, json)
        if (!json) {
          throw new Error(`fox returned error code ${reply.status}`)
        } else if (!json.success) {
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

          io.console.error('fox error:', json)
          throw new Error('fox.exchange replied: ' + json.error || json.code)
        }

        return json.data
      }

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

        const rateResp: RateInfo = await post('/rate', rateReq)
        let sourceAmount: number
        let targetAmount: number

        if (request.quoteFor === 'from') {
          if (rateResp.destinationCoinAmount) {
            targetAmount = rateResp.destinationCoinAmount
          } else if (
            rateReq.depositCoinAmount &&
            rateResp.limitMinDepositCoin &&
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
            rateReq.depositCoinAmount &&
            rateResp.limitMaxDepositCoin &&
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
          if (rateResp.depositCoinAmount) {
            sourceAmount = rateResp.depositCoinAmount
          } else if (
            rateReq.destinationCoinAmount &&
            rateResp.limitMinDestinationCoin &&
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
            rateReq.destinationCoinAmount &&
            rateResp.limitMaxDestinationCoin &&
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
          rateResp.dummyAddress ||
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
              publicAddress: dummyAddress,
              otherParams: {}
            }
          ]
        })

        const destinationAddress = await getAddress(
          request.toWallet,
          request.toCurrencyCode
        )

        const quote: EdgeSwapPluginQuote = {
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
            nativeAmount: dummyTx.networkFee
          },
          destinationAddress,
          pluginName: swapInfo.pluginName,
          expirationDate: new Date(
            rateResp.validTill || Date.now() + expirationMs
          ),
          quoteId: rateResp.futureOrderId,
          isEstimate: !rateResp.quoteToken,

          async approve(): Promise<EdgeTransaction> {
            const orderResp: OrderInfo = await post('/order', {
              depositCoin: request.fromCurrencyCode,
              destinationCoin: request.toCurrencyCode,
              depositCoinAmount:
                rateReq.depositCoinAmount || rateResp.depositCoinAmount,
              destinationAddress: {
                address: destinationAddress,
                tag: null
              },
              futureOrderId: rateResp.futureOrderId,
              quoteToken: rateResp.quoteToken
            })

            io.console.info(`fox transaction ID: ${orderResp.orderId}`)

            const tx: EdgeTransaction = await request.fromWallet.makeSpend({
              currencyCode: request.fromCurrencyCode,
              spendTargets: [
                {
                  nativeAmount: await request.fromWallet.denominationToNative(
                    String(orderResp.expectedDepositCoinAmount),
                    request.fromCurrencyCode
                  ),
                  publicAddress: orderResp.exchangeAddress.address,
                  otherParams: {
                    uniqueIdentifier: orderResp.exchangeAddress.tag
                  }
                }
              ]
            })

            // This seems to be required to format transaction description correctly
            if (!tx.otherParams) tx.otherParams = {}
            tx.otherParams.payinAddress = orderResp.exchangeAddress.address
            tx.otherParams.uniqueIdentifier = orderResp.exchangeAddress.tag

            const signedTransaction = await request.fromWallet.signTx(tx)
            const broadcastedTransaction = await request.fromWallet.broadcastTx(
              signedTransaction
            )
            await request.fromWallet.saveTx(signedTransaction)

            return broadcastedTransaction
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
        io.console.info(`fox exception`, e)
        throw e
      }
    }
  }

  return out
}
