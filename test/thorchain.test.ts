import { assert } from 'chai'
import { describe, it } from 'mocha'

import {
  appendMayaRefundAddress,
  getVolatilitySpread
} from '../src/swap/defi/thorchain/thorchainCommon'

describe(`appendMayaRefundAddress`, function () {
  const refund = 't1MnUkHpi3Ampr9ZzAtnWHFbatsVF3hEvKL'

  it('appends the refund to the destination field of a Maya memo', function () {
    const memo = '=:d:XnzErKGuqcG5Ci5oTsQv7stwCBofgChu8s:0/1/1:ej:75'
    const result = appendMayaRefundAddress(memo, refund)
    assert.equal(
      result,
      '=:d:XnzErKGuqcG5Ci5oTsQv7stwCBofgChu8s/t1MnUkHpi3Ampr9ZzAtnWHFbatsVF3hEvKL:0/1/1:ej:75'
    )
  })

  it('leaves the asset and trailing fields untouched', function () {
    const memo = '=:e:0x742d35Cc6634C0532925a3b844Bc454e4438f44e::ej:75'
    const result = appendMayaRefundAddress(memo, refund)
    const fields = result.split(':')
    // index 1 (asset) and the affiliate/bps tail are unchanged; only the
    // destination field (index 2) gains the refund.
    assert.equal(fields[1], 'e')
    assert.equal(
      fields[2],
      `0x742d35Cc6634C0532925a3b844Bc454e4438f44e/${refund}`
    )
    assert.equal(fields[4], 'ej')
    assert.equal(fields[5], '75')
  })

  it('returns a memo with no destination field unchanged', function () {
    assert.equal(appendMayaRefundAddress('=:d', refund), '=:d')
    assert.equal(appendMayaRefundAddress('', refund), '')
  })
})

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
