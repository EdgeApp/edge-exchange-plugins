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
      initOptions: {
        apiKey:
          'MIIBCgKCAQEA3n4hiBjUcSQIhxiaKmSSRbAj8l6KgYUST6gF/K59lnH2vQ01j8IevXROFp6+5O1k8NvJrl5SJgFPkCLpozPWkMKrCShi6pLHAINZ7DxXNgptLCrbfWtC+TpxErsU2BRx80qECMhc3Y5XEfHCB1ab7ajGNFG2vAjzP5i8TyMqsg2bKIH2PnMkU0umA+bcHMkzg0ZV20eW8NlBN5rjYliC9+e00nMClzdXs4RTmeFvE9p7ZGRP2BiZ/gk36OZa9pkA6oV86urX1R2pukegWuXuGlk1si504MWClC/bbenbGvofEsOjtRX0xkaYnecc/97PG+o7DEIeHDvJqPDS5c1ZOQIDAQAB',
        secret:
          '308204bd020100300d06092a864886f70d0101010500048204a7308204a30201000282010100de7e218818d471240887189a2a649245b023f25e8a8185124fa805fcae7d9671f6bd0d358fc21ebd744e169ebee4ed64f0dbc9ae5e5226014f9022e9a333d690c2ab092862ea92c7008359ec3c57360a6d2c2adb7d6b42f93a7112bb14d81471f34a8408c85cdd8e5711f1c207569beda8c63451b6bc08f33f98bc4f232ab20d9b2881f63e7324534ba603e6dc1cc933834655db4796f0d941379ae3625882f7e7b4d27302973757b3845399e16f13da7b64644fd81899fe0937e8e65af69900ea857ceaead7d51da9ba47a05ae5ee1a5935b22e74e0c582942fdb6de9db1afa1f12c3a3b515f4c646989de71cffdecf1bea3b0c421e1c3bc9a8f0d2e5cd5939020301000102820100617459f7a4f898be31c60aeeac16f542f50e29c16365ac06034213ad4438da46fcce7e14b1ed534da4bdf7867d130530ab9779d59896def2c008e061fa0c60b573af3b09a79a1bc472e315e635dff559c7cc0ad1ad33e858065334e321142c90650284a6dc2c611751e8183ee6bbf6fcb86a68cc4a003ee35d3de76dba779f19296cfa9dda81f78eaff8d75036f572bc51bc1363807196a66afd2a6d7bfb784a8854a1f9ce15c90451a7ced8bdf8d129bd511741c7569cffff0507e3fa5a7861443be3836975a9171576e979fd26f5ca1a7003b12d590f99d93c61ac864b914f2029c5451e7e8ea806b95bc5b334b72f854a27718830c06193abd425dbbf4c4902818100f5c9303b593ec848e0caeefff06c135e5a86e2eeac32694967dec02aeb74ad2e400f3e4b13d780b7326656cefcecd5370a2af0e59410009c914ec482430ebd190d49901c6b3a83ed934c36bedf1e6f90e0e49de8861456196506fe6edd144fe5de842a6f0692305dc5360f53e061b0aff5763201a3ffd37c48529a0697f8127b02818100e7bd22de13622dfb799c407748630e1ae4ca08926e0219cc9572fd4359816e76bad3f317d37fc7844825d94223029084be04cfcc3bca34b0ed7565729c1590ecf12586784e69cd48b6d43d6d5475d52cbd175c5b0a95bdd8700b7f4293c6be48d65f12128722bf3b0776b078d01e2af1dc4228cad6e34280a695889954677edb02818100b548a92c7d0cd388fd5470a791db050628db287245cc00e0459e843aa3e430ffd5fbe84453e43569e9e095d2a1b6c5248d7952a8e266532d27f7e2f4f924dbd0a87e43aed2601c82948c382cdc4084a5655afa25510f9ad9ac2c5669cae27a73df85b80e9fd81f986a270f731c22b1c176d8b0d588f2de37e2d81a0716fbc0150281807e8dad92f5a6f251991219aa8a9f7dbe761f571b1074993e3e877383ea4762d9f821736a1998788ee70fb45c07de88a9d553af5f6b6f7be2fb6ad72205d74933fc656fd01792740737c12462a6734b1d898e4e63719e60f4e80b7f4e0e81c4bce645390b613d3a8db3ffbf53dae3feb3e28346dfaf06a0f4bd04807aabbb716d0281805c87106ae73bfc5132a9eafbf2fa8eb9350cfd8a53c8875f73f8e6fd9ed94f4b0e7d390e0015a64d7e2128b70b4d6627506050f85a2e5c245836567e2177b56f2b2f65dbd8a1ccef9be412b8a2fe65029c5d1715b45caf17c9a5a0cc5a38ed9becf02f3513bc4981c07cfe20d92b9feb808e9e5a1e445800ad4e6580cc4c4c18'
      },
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
