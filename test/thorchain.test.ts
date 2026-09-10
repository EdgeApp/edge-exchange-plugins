import { assert } from 'chai'
import { describe, it } from 'mocha'

import { getVolatilitySpread } from '../src/swap/defi/thorchain/thorchainCommon'

describe(`getVolatilitySpread`, function () {
  it('bitcoin source', function () {
    const result = getVolatilitySpread({
      fromPluginId: 'bitcoin',
      fromTokenId: null,
      fromCurrencyCode: 'BTC',
      toPluginId: 'ethereum',
      toTokenId: null,
      toCurrencyCode: 'ETH',
      likeKindVolatilitySpread: 0.01,
      volatilitySpread: 0.02,
      perAssetSpread: [
        {
          sourcePluginId: 'ethereum',
          sourceTokenId: undefined,
          destPluginId: undefined,
          destTokenId: undefined,
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.001
        },
        {
          sourcePluginId: 'bitcoin',
          sourceTokenId: undefined,
          destPluginId: undefined,
          destTokenId: undefined,
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.003
        }
      ]
    })
    assert.equal(result, '0.003')
  })
})

describe(`getVolatilitySpread`, function () {
  it('eth.usdc dest', function () {
    const result = getVolatilitySpread({
      fromPluginId: 'bitcoin',
      fromTokenId: null,
      fromCurrencyCode: 'BTC',
      toPluginId: 'ethereum',
      toTokenId: 'usdctokenid',
      toCurrencyCode: 'USDC',
      likeKindVolatilitySpread: 0.01,
      volatilitySpread: 0.02,
      perAssetSpread: [
        {
          sourcePluginId: 'litecoin',
          sourceTokenId: undefined,
          destPluginId: 'ethereum',
          destTokenId: 'someothertokenid',
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.001
        },
        {
          sourcePluginId: 'dogecoin',
          sourceTokenId: undefined,
          destPluginId: undefined,
          destTokenId: undefined,
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.003
        },
        {
          sourcePluginId: 'bitcoin',
          sourceTokenId: undefined,
          destPluginId: 'ethereum',
          destTokenId: 'usdctokenid',
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.00321
        }
      ]
    })
    assert.equal(result, '0.00321')
  })
})

describe(`getVolatilitySpread`, function () {
  it('like kind', function () {
    const result = getVolatilitySpread({
      fromPluginId: 'bitcoin',
      fromTokenId: null,
      fromCurrencyCode: 'BTC',
      toPluginId: 'ethereum',
      toTokenId: 'wbtctokenid',
      toCurrencyCode: 'WBTC',
      likeKindVolatilitySpread: 0.001,
      volatilitySpread: 0.002,
      perAssetSpread: [
        {
          sourcePluginId: 'ethereum',
          sourceTokenId: undefined,
          destPluginId: undefined,
          destTokenId: undefined,
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.001
        },
        {
          sourcePluginId: 'litecoin',
          sourceTokenId: undefined,
          destPluginId: undefined,
          destTokenId: undefined,
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.003
        },
        {
          sourcePluginId: undefined,
          sourceTokenId: undefined,
          destPluginId: 'ethereum',
          destTokenId: 'usdctokenid',
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.00321
        }
      ]
    })
    assert.equal(result, '0.001')
  })
})

describe(`getVolatilitySpread`, function () {
  it('non like kind', function () {
    const result = getVolatilitySpread({
      fromPluginId: 'bitcoin',
      fromTokenId: null,
      fromCurrencyCode: 'BTC',
      toPluginId: 'litecoin',
      toTokenId: null,
      toCurrencyCode: 'LTC',
      likeKindVolatilitySpread: 1,
      volatilitySpread: 2,
      perAssetSpread: [
        {
          sourcePluginId: 'ethereum',
          sourceTokenId: undefined,
          destPluginId: undefined,
          destTokenId: undefined,
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.1
        },
        {
          sourcePluginId: 'litecoin',
          sourceTokenId: undefined,
          destPluginId: undefined,
          destTokenId: undefined,
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.3
        },
        {
          sourcePluginId: undefined,
          sourceTokenId: undefined,
          destPluginId: 'ethereum',
          destTokenId: 'usdctokenid',
          sourceCurrencyCode: undefined,
          destCurrencyCode: undefined,
          volatilitySpread: 0.321
        }
      ]
    })
    assert.equal(result, '2')
  })
})
