import { assert } from 'chai'
import {
  EdgeCurrencyWallet,
  EdgeSwapInfo,
  EdgeTokenId
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  getNodeLimitUnits,
  getVolatilitySpread
} from '../src/swap/defi/thorchain/thorchainCommon'

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

describe(`getNodeLimitUnits`, function () {
  const mayaSwapInfo: EdgeSwapInfo = {
    pluginId: 'mayaprotocol',
    isDex: true,
    displayName: 'Maya Protocol',
    supportEmail: 'support@edge.app'
  }
  const thorSwapInfo: EdgeSwapInfo = {
    pluginId: 'thorchain',
    isDex: true,
    displayName: 'Thorchain',
    supportEmail: 'support@edge.app'
  }

  const makeWallet = (
    pluginId: string,
    currencyCode: string,
    multiplier: string,
    tokens: {
      [tokenId: string]: { currencyCode: string; multiplier: string }
    } = {}
  ): EdgeCurrencyWallet => {
    const currencyInfo = {
      currencyCode,
      pluginId,
      denominations: [{ name: currencyCode, multiplier }]
    }
    const allTokens: { [tokenId: string]: unknown } = {}
    for (const tokenId of Object.keys(tokens)) {
      allTokens[tokenId] = {
        currencyCode: tokens[tokenId].currencyCode,
        denominations: [
          {
            name: tokens[tokenId].currencyCode,
            multiplier: tokens[tokenId].multiplier
          }
        ]
      }
    }
    // Only the fields getNodeLimitUnits reads are needed:
    return ({
      currencyInfo,
      currencyConfig: { allTokens }
    } as unknown) as EdgeCurrencyWallet
  }

  const usdtTokenId: EdgeTokenId = 'dac17f958d2ee523a2206206994597c13d831ec7'
  const ethWallet = makeWallet('ethereum', 'ETH', '1000000000000000000', {
    [usdtTokenId]: { currencyCode: 'USDT', multiplier: '1000000' }
  })
  const adaWallet = makeWallet('cardano', 'ADA', '1000000')
  const btcWallet = makeWallet('bitcoin', 'BTC', '100000000')
  const mayaTokenId: EdgeTokenId = 'mayatokenid'
  const cacaoWallet = makeWallet('mayachain', 'CACAO', '10000000000', {
    [mayaTokenId]: { currencyCode: 'MAYA', multiplier: '10000' }
  })

  // Mayanode quotes assets on external chains in 1e8 regardless of the asset's
  // own precision. Feeding it the native precision makes it quote the wrong
  // amount (or error outright), which drops the provider from the quote list.
  it('maya: external EVM mainnet coin uses 1e8, not its 1e18 precision', function () {
    assert.equal(getNodeLimitUnits(mayaSwapInfo, ethWallet, null), '100000000')
  })

  it('maya: external EVM token uses 1e8, not its 1e6 precision', function () {
    assert.equal(
      getNodeLimitUnits(mayaSwapInfo, ethWallet, usdtTokenId),
      '100000000'
    )
  })

  it('maya: external non-EVM chain uses 1e8, not its 1e6 precision', function () {
    assert.equal(getNodeLimitUnits(mayaSwapInfo, adaWallet, null), '100000000')
  })

  it('maya: external chain that is natively 1e8 uses 1e8', function () {
    assert.equal(getNodeLimitUnits(mayaSwapInfo, btcWallet, null), '100000000')
  })

  // Maya's own chain-native assets keep their native precision:
  it('maya: chain-native CACAO uses its 1e10 precision', function () {
    assert.equal(
      getNodeLimitUnits(mayaSwapInfo, cacaoWallet, null),
      '10000000000'
    )
  })

  it('maya: chain-native MAYA token uses its 1e4 precision', function () {
    assert.equal(
      getNodeLimitUnits(mayaSwapInfo, cacaoWallet, mayaTokenId),
      '10000'
    )
  })

  // Thornode normalizes everything to 1e8:
  it('thorchain: always uses 1e8', function () {
    assert.equal(
      getNodeLimitUnits(thorSwapInfo, ethWallet, usdtTokenId),
      '100000000'
    )
    assert.equal(getNodeLimitUnits(thorSwapInfo, btcWallet, null), '100000000')
  })
})
