import { assert } from 'chai'
import { EdgeIo, EdgeSwapRequest } from 'edge-core-js/src/types/types'
import {
  EdgeCorePluginOptions,
  EdgeSwapPlugin,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeCriptointercambioPlugin } from '../../src/swap/criptointercambio'

describe(`criptointercambio swap plugin`, function () {
  it('Should check for initOpts validity', function () {
    let error = null
    try {
      makeCriptointercambioPlugin(({
        initOptions: { apiKey: '', secret: null },
        io: ({ fetchCors: () => {} } as unknown) as EdgeIo
      } as unknown) as EdgeCorePluginOptions)
    } catch (e) {
      error = e
    }

    assert.isNotNull(error)
    assert.equal(
      (error as Error).message,
      'No Criptointercambio apiKey or secret provided.'
    )
  })

  it('Should provide required swap options', function () {
    let error = null
    let plugin: EdgeSwapPlugin | null = null
    try {
      plugin = makeCriptointercambioPlugin(({
        initOptions: { apiKey: 'abc', secret: 'def' },
        io: ({ fetchCors: () => {} } as unknown) as EdgeIo
      } as unknown) as EdgeCorePluginOptions)
    } catch (e) {
      error = e
    }

    assert.isNull(error)
    assert.isNotNull(plugin)
    assert.hasAllKeys(plugin, ['swapInfo', 'fetchSwapQuote'])
    assert.hasAllKeys(plugin?.swapInfo, [
      'pluginId',
      'displayName',
      'supportEmail'
    ])
  })

  describe('Should have correct fetchSwapQuote', () => {
    let receivedRequests: any[] = []
    let preparedResponses: Function[] = []

    const plugin = makeCriptointercambioPlugin(({
      initOptions: { apiKey: 'abc', secret: 'def' },
      io: ({
        fetchCors: (uri: string, opts: any) => {
          receivedRequests.push({ uri, opts })
          if (preparedResponses.length > 0) {
            const response = preparedResponses.shift()
            if (response != null) {
              return response()
            }
          }
          throw Error('No mocked response found')
        }
      } as unknown) as EdgeIo
    } as unknown) as EdgeCorePluginOptions)

    beforeEach(() => {
      receivedRequests = []
      preparedResponses = []
    })

    it('Should avoid invalid codes', async () => {
      let error = null
      try {
        await plugin.fetchSwapQuote(
          ({
            fromCurrencyCode: 'BNB',
            fromWallet: {
              currencyInfo: {
                pluginId: 'ethereum'
              }
            },
            toWallet: {
              currencyInfo: {
                pluginId: 'ethereum'
              }
            },
            toCurrencyCode: 'ETH'
          } as unknown) as EdgeSwapRequest,
          {},
          {}
        )
      } catch (e) {
        error = e
      }
      assert.isNotNull(error)
      assert.equal((error as Error).name, SwapCurrencyError.name)
      assert.equal(
        (error as Error).message,
        'Criptointercambio does not support BNB to ETH'
      )
    })

    it('Should work only with eth tokens', async () => {
      let error = null
      try {
        await plugin.fetchSwapQuote(
          ({
            fromCurrencyCode: 'BTC',
            fromWallet: {
              currencyInfo: {
                pluginId: 'bitcoin'
              }
            },
            toWallet: {
              currencyInfo: {
                pluginId: 'ethereum'
              }
            },
            toCurrencyCode: 'ETH'
          } as unknown) as EdgeSwapRequest,
          {},
          {}
        )
      } catch (e) {
        error = e
      }

      assert.isNotNull(error)
      assert.equal((error as Error).name, SwapCurrencyError.name)
      assert.equal(
        (error as Error).message,
        'Criptointercambio does not support BTC to ETH'
      )
    })

    it('Should handle estimation errors correctly', async () => {
      let error = null
      preparedResponses = [
        () => {
          return {
            ok: true,
            json: () => ({
              jsonrpc: '2.0',
              id: 'test',
              error: {
                code: -32600,
                message: 'Invalid amount: minimal amount for eth->btc is 0.0816'
              }
            })
          }
        }
      ]
      try {
        await plugin.fetchSwapQuote(
          ({
            fromCurrencyCode: 'ltsc',
            fromWallet: {
              currencyInfo: {
                currencyCode: 'ETH',
                pluginId: 'ethereum'
              },
              nativeToDenomination: (nativeAmount: string, code: string) => {
                assert.equal(nativeAmount, '1.0')
                assert.equal(code, 'ltsc')

                return '1.0'
              },
              denominationToNative: (
                denominationAmount: string,
                code: string
              ) => {
                assert.equal(denominationAmount, '0.0816')
                assert.equal(code, 'ltsc')

                return denominationAmount
              },
              getReceiveAddress: () => ({ publicAddress: '0xabcde' })
            },
            toWallet: {
              currencyInfo: {
                currencyCode: 'ETH',
                pluginId: 'ethereum'
              },
              getReceiveAddress: () => ({ publicAddress: '0xedcba' }),
              nativeToDenomination: () => {
                throw new Error('Should not have been called')
              }
            },
            nativeAmount: '1.0',
            toCurrencyCode: 'ETH',
            quoteFor: 'from'
          } as unknown) as EdgeSwapRequest,
          {},
          {}
        )
      } catch (e) {
        error = e
      }

      assert.isNotNull(error)
      assert.equal((error as Error).name, SwapBelowLimitError.name)
      assert.equal((error as SwapBelowLimitError).direction, 'from')
      assert.equal((error as SwapBelowLimitError).nativeMin, '0.0816')
      assert.lengthOf(receivedRequests, 1)
      const requestBody = JSON.parse(receivedRequests[0].opts.body)
      assert.equal(requestBody.method, 'getFixRateForAmount')
      assert.containsAllKeys(requestBody.params, ['from', 'to', 'amountFrom'])
    })

    it('Should handle creation errors correctly', async () => {
      let error = null
      preparedResponses = [
        () => {
          return {
            ok: true,
            json: () => ({
              jsonrpc: '2.0',
              id: 'test',
              result: {
                id: 'f4dd43106d63b65b88955a0b36******ffb7a8480dd32e799431177f',
                result: '0.02556948',
                networkFee: '0.000175',
                from: 'eth',
                to: 'btc',
                max: '50.000000000000000000',
                maxFrom: '50.000000000000000000',
                maxTo: '1.27847400',
                min: '0.148414210000000000',
                minFrom: '0.148414210000000000',
                minTo: '0.00379488',
                amountFrom: '5.2',
                amountTo: '0.34047438',
                expiredAt: 1664890979000000
              }
            })
          }
        },
        () => ({
          ok: true,
          json: () => ({
            error: {
              code: -32012,
              message: 'Expired'
            }
          })
        })
      ]
      try {
        await plugin.fetchSwapQuote(
          ({
            fromCurrencyCode: 'ltsb',
            fromWallet: {
              currencyInfo: {
                currencyCode: 'ETH',
                pluginId: 'ethereum'
              },
              nativeToDenomination: (nativeAmount: string, code: string) => {
                assert.equal(nativeAmount, '1.0')
                assert.equal(code, 'ltsb')

                return nativeAmount
              },
              denominationToNative: (
                denominationAmount: string,
                code: string
              ) => {
                throw new Error('Not expected to have been called')
              },
              getReceiveAddress: () => ({ publicAddress: '0xabcde' })
            },
            toWallet: {
              currencyInfo: {
                currencyCode: 'ETH',
                pluginId: 'ethereum'
              },
              getReceiveAddress: () => ({ publicAddress: '0xedcba' }),
              nativeToDenomination: () => {
                throw new Error('Should not have been called')
              }
            },
            nativeAmount: '1.0',
            toCurrencyCode: 'ETH',
            quoteFor: 'from'
          } as unknown) as EdgeSwapRequest,
          {},
          {}
        )
      } catch (e) {
        error = e
      }

      assert.isNotNull(error)
      assert.equal((error as Error).name, Error.name)
      assert.lengthOf(receivedRequests, 2)
      const request1Body = JSON.parse(receivedRequests[0].opts.body)
      assert.equal(request1Body.method, 'getFixRateForAmount')
      const request2Body = JSON.parse(receivedRequests[1].opts.body)
      assert.equal(request2Body.method, 'createFixTransaction')
      assert.containsAllKeys(request2Body.params, [
        'from',
        'to',
        'amountFrom',
        'rateId',
        'address',
        'refundAddress'
      ])
    })

    it('Should handle creation correctly', async () => {
      let error = null
      let quote = null
      let spent = false
      preparedResponses = [
        () => {
          return {
            ok: true,
            json: () => ({
              jsonrpc: '2.0',
              id: 'test',
              result: {
                id: 'f4dd43106d63b65b88955a0b36******ffb7a8480dd32e799431177f',
                result: '0.02556948',
                networkFee: '0.000175',
                from: 'eth',
                to: 'btc',
                max: '50.000000000000000000',
                maxFrom: '50.000000000000000000',
                maxTo: '1.27847400',
                min: '0.148414210000000000',
                minFrom: '0.148414210000000000',
                minTo: '0.00379488',
                amountFrom: '5.2',
                amountTo: '0.34047438',
                expiredAt: 1664890979000000
              }
            })
          }
        },
        () => ({
          ok: true,
          json: () => ({
            result: {
              id: '149a****m90',
              trackUrl: 'https://changelly.com/track/149a****m90',
              type: 'fixed',
              status: 'new',
              payTill: new Date(
                new Date().getTime() + 1000 * 60 * 10
              ).toISOString(),
              currencyFrom: 'ltsb',
              currencyTo: 'eth',
              payinExtraId: null,
              payoutExtraId: null,
              refundAddress: '1Bvjij5653y9r********QBPzTZpb',
              amountExpectedFrom: '1.00000000',
              amountExpectedTo: '32.277489930000000000',
              payinAddress: '3EkyEjzs********vZ95AyTM',
              payoutAddress: '0xeee031413*******B8Cf5E3DFc214',
              createdAt: new Date().getTime()
            }
          })
        })
      ]
      try {
        quote = await plugin.fetchSwapQuote(
          ({
            fromCurrencyCode: 'ltsb',
            fromWallet: {
              currencyInfo: {
                currencyCode: 'ETH',
                pluginId: 'ethereum'
              },
              nativeToDenomination: (nativeAmount: string, code: string) => {
                assert.equal(nativeAmount, '1.0')
                assert.equal(code, 'ltsb')

                return nativeAmount
              },
              denominationToNative: (
                denominationAmount: string,
                code: string
              ) => {
                throw new Error('Not expected to have been called')
              },
              getReceiveAddress: () => ({ publicAddress: '0xabcde' }),
              makeSpend: () => {
                spent = true

                return { parentNetworkFee: null, networkFee: '0.001' }
              }
            },
            toWallet: {
              currencyInfo: {
                currencyCode: 'ETH',
                pluginId: 'ethereum'
              },
              getReceiveAddress: () => ({ publicAddress: '0xedcba' }),
              nativeToDenomination: () => {
                throw new Error('Should not have been called')
              }
            },
            nativeAmount: '1.0',
            toCurrencyCode: 'ETH',
            quoteFor: 'from'
          } as unknown) as EdgeSwapRequest,
          {},
          {}
        )
      } catch (e) {
        error = e
      }

      assert.isNull(error)
      assert.equal(spent, true)
      assert.lengthOf(receivedRequests, 2)
      const request1Body = JSON.parse(receivedRequests[0].opts.body)
      assert.equal(request1Body.method, 'getFixRateForAmount')
      const request2Body = JSON.parse(receivedRequests[1].opts.body)
      assert.equal(request2Body.method, 'createFixTransaction')

      assert.isNotNull(quote)
      assert.containsAllKeys(quote, [
        'swapInfo',
        'fromNativeAmount',
        'toNativeAmount',
        'networkFee',
        'pluginId',
        'expirationDate'
      ])
    })
  })
})
