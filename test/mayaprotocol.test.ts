import { assert } from 'chai'
import {
  EdgeCurrencyWallet,
  EdgeSwapInfo,
  EdgeTokenId
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  getNodeLimitUnits,
  isProviderNativeDeposit
} from '../src/swap/defi/thorchain/thorchainCommon'

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

interface FakeToken {
  tokenId: string
  currencyCode: string
  multiplier: string
}

const makeFakeWallet = (
  pluginId: string,
  currencyCode: string,
  multiplier: string,
  tokens: FakeToken[] = []
): EdgeCurrencyWallet => {
  const allTokens: {
    [tokenId: string]: {
      currencyCode: string
      denominations: Array<{ name: string; multiplier: string }>
    }
  } = {}
  for (const token of tokens) {
    allTokens[token.tokenId] = {
      currencyCode: token.currencyCode,
      denominations: [
        { name: token.currencyCode, multiplier: token.multiplier }
      ]
    }
  }

  // Only the fields getNodeLimitUnits/getTokenMultiplier read are needed:
  return ({
    currencyInfo: {
      pluginId,
      currencyCode,
      denominations: [{ name: currencyCode, multiplier }]
    },
    currencyConfig: { allTokens }
  } as unknown) as EdgeCurrencyWallet
}

const ethWallet = makeFakeWallet('ethereum', 'ETH', '1000000000000000000', [
  { tokenId: 'usdttokenid', currencyCode: 'USDT', multiplier: '1000000' }
])
const dashWallet = makeFakeWallet('dash', 'DASH', '100000000')
const mayachainWallet = makeFakeWallet('mayachain', 'CACAO', '10000000000', [
  { tokenId: 'mayatokenid', currencyCode: 'MAYA', multiplier: '10000' }
])
const thorchainruneWallet = makeFakeWallet('thorchainrune', 'RUNE', '100000000')

describe(`getNodeLimitUnits`, function () {
  // Mayanode normalizes bridged assets to 1e8 no matter their own precision,
  // so these must NOT resolve to the asset's native multiplier. Using USDT's
  // native 1e6 here over-estimated Maya quotes by 100x.
  const bridgedCases: Array<[string, EdgeCurrencyWallet, EdgeTokenId]> = [
    ['ethereum USDT token', ethWallet, 'usdttokenid'],
    ['ethereum mainnet', ethWallet, null],
    ['dash mainnet', dashWallet, null]
  ]
  for (const [name, wallet, tokenId] of bridgedCases) {
    it(`maya uses 1e8 for ${name}`, function () {
      assert.equal(
        getNodeLimitUnits(mayaSwapInfo, wallet, tokenId),
        '100000000'
      )
    })
  }

  // MAYAChain's own assets are the exception: Mayanode expresses those in
  // their native precision.
  it('maya uses native 1e10 for CACAO', function () {
    assert.equal(
      getNodeLimitUnits(mayaSwapInfo, mayachainWallet, null),
      '10000000000'
    )
  })

  it('maya uses native 1e4 for the MAYA token', function () {
    assert.equal(
      getNodeLimitUnits(mayaSwapInfo, mayachainWallet, 'mayatokenid'),
      '10000'
    )
  })

  // Thornode normalizes everything, including MAYAChain assets.
  it('thorchain always uses 1e8', function () {
    assert.equal(
      getNodeLimitUnits(thorSwapInfo, ethWallet, 'usdttokenid'),
      '100000000'
    )
    assert.equal(
      getNodeLimitUnits(thorSwapInfo, mayachainWallet, null),
      '100000000'
    )
  })
})

describe(`isProviderNativeDeposit`, function () {
  // The MsgDeposit path only applies on the provider's own protocol chain.
  it('thorchain deposits RUNE', function () {
    assert.equal(
      isProviderNativeDeposit(thorSwapInfo, thorchainruneWallet),
      true
    )
  })

  it('maya deposits CACAO', function () {
    assert.equal(isProviderNativeDeposit(mayaSwapInfo, mayachainWallet), true)
  })

  // RUNE is an external asset to Maya. It must be sent to Maya's inbound
  // address like any other chain — depositing it hands Maya's memo to
  // THORChain, which misparses it (e.g. `=:d:<dashAddr>` becomes a DOGE swap
  // with an unparseable address).
  it('maya must NOT deposit RUNE', function () {
    assert.equal(
      isProviderNativeDeposit(mayaSwapInfo, thorchainruneWallet),
      false
    )
  })

  it('thorchain must NOT deposit CACAO', function () {
    assert.equal(isProviderNativeDeposit(thorSwapInfo, mayachainWallet), false)
  })

  it('external chains never deposit', function () {
    assert.equal(isProviderNativeDeposit(mayaSwapInfo, dashWallet), false)
    assert.equal(isProviderNativeDeposit(thorSwapInfo, ethWallet), false)
  })
})
