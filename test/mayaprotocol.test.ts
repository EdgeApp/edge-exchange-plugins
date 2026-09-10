import { mul } from 'biggystring'
import { assert } from 'chai'
import {
  EdgeCurrencyWallet,
  EdgeSwapInfo,
  EdgeTokenId
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { MAYA_NATIVE_CHAIN } from '../src/swap/defi/thorchain/mayaprotocol'
import { THORCHAIN_NATIVE_CHAIN } from '../src/swap/defi/thorchain/thorchain'
import {
  getNodeLimitUnits,
  getPool,
  isProviderNativeDeposit
} from '../src/swap/defi/thorchain/thorchainCommon'
import { INVALID_TOKEN_IDS } from '../src/swap/defi/thorchain/thorchainConstants'
import { EdgeSwapRequestPlugin } from '../src/swap/types'
import { mergeInvalidTokenIds } from '../src/util/swapHelpers'
import { getTokenMultiplier } from '../src/util/utils'

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
const thorchainruneWallet = makeFakeWallet(
  'thorchainrune',
  'RUNE',
  '100000000',
  [{ tokenId: 'tcytokenid', currencyCode: 'TCY', multiplier: '100000000' }]
)

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
        getNodeLimitUnits(MAYA_NATIVE_CHAIN, wallet, tokenId),
        '100000000'
      )
    })
  }

  // MAYAChain's own assets are the exception: Mayanode expresses those in
  // their native precision.
  it('maya uses native 1e10 for CACAO', function () {
    assert.equal(
      getNodeLimitUnits(MAYA_NATIVE_CHAIN, mayachainWallet, null),
      '10000000000'
    )
  })

  it('maya uses native 1e4 for the MAYA token', function () {
    assert.equal(
      getNodeLimitUnits(MAYA_NATIVE_CHAIN, mayachainWallet, 'mayatokenid'),
      '10000'
    )
  })

  // Thornode normalizes everything, including MAYAChain assets and its own.
  it('thorchain always uses 1e8', function () {
    assert.equal(
      getNodeLimitUnits(THORCHAIN_NATIVE_CHAIN, ethWallet, 'usdttokenid'),
      '100000000'
    )
    assert.equal(
      getNodeLimitUnits(THORCHAIN_NATIVE_CHAIN, mayachainWallet, null),
      '100000000'
    )
    assert.equal(
      getNodeLimitUnits(THORCHAIN_NATIVE_CHAIN, thorchainruneWallet, null),
      '100000000'
    )
    assert.equal(
      getNodeLimitUnits(
        THORCHAIN_NATIVE_CHAIN,
        thorchainruneWallet,
        'tcytokenid'
      ),
      '100000000'
    )
  })
})

describe(`isProviderNativeDeposit`, function () {
  // The MsgDeposit path only applies on the provider's own protocol chain.
  it('thorchain deposits RUNE', function () {
    assert.equal(
      isProviderNativeDeposit(THORCHAIN_NATIVE_CHAIN, thorchainruneWallet),
      true
    )
  })

  it('maya deposits CACAO', function () {
    assert.equal(
      isProviderNativeDeposit(MAYA_NATIVE_CHAIN, mayachainWallet),
      true
    )
  })

  // RUNE is an external asset to Maya. It must be sent to Maya's inbound
  // address like any other chain: depositing it hands Maya's memo to
  // THORChain, which misparses it (e.g. `=:d:<dashAddr>` becomes a DOGE swap
  // with an unparseable address).
  it('maya must NOT deposit RUNE', function () {
    assert.equal(
      isProviderNativeDeposit(MAYA_NATIVE_CHAIN, thorchainruneWallet),
      false
    )
  })

  it('thorchain must NOT deposit CACAO', function () {
    assert.equal(
      isProviderNativeDeposit(THORCHAIN_NATIVE_CHAIN, mayachainWallet),
      false
    )
  })

  it('external chains never deposit', function () {
    assert.equal(isProviderNativeDeposit(MAYA_NATIVE_CHAIN, dashWallet), false)
    assert.equal(
      isProviderNativeDeposit(THORCHAIN_NATIVE_CHAIN, ethWallet),
      false
    )
  })
})

describe(`native chain profiles`, function () {
  // The max-quote probe seed is denominated so it reads as an amount of the
  // base asset; multiplied out it must equal what each node needs to clear
  // its minimum: 10 RUNE and 1000 CACAO.
  it('thorchain probes max quotes with 10 RUNE', function () {
    assert.equal(
      mul(
        THORCHAIN_NATIVE_CHAIN.maxQuoteSeedExchangeAmount,
        getTokenMultiplier(thorchainruneWallet, null)
      ),
      '1000000000'
    )
  })

  it('maya probes max quotes with 1000 CACAO', function () {
    assert.equal(
      mul(
        MAYA_NATIVE_CHAIN.maxQuoteSeedExchangeAmount,
        getTokenMultiplier(mayachainWallet, null)
      ),
      '10000000000000'
    )
  })
})

describe(`mergeInvalidTokenIds`, function () {
  it('keeps the shared exclusions and adds the provider ones', function () {
    const merged = mergeInvalidTokenIds(INVALID_TOKEN_IDS, {
      from: { zcash: 'allCodes' },
      to: {}
    })
    assert.deepEqual(merged.from.optimism, INVALID_TOKEN_IDS.from.optimism)
    assert.equal(merged.from.zcash, 'allCodes')
    assert.deepEqual(merged.to, {})
  })

  it('leaves the shared list unchanged without provider exclusions', function () {
    assert.deepEqual(mergeInvalidTokenIds(INVALID_TOKEN_IDS), INVALID_TOKEN_IDS)
  })
})

// Only the fields SwapCurrencyError reads:
const fakeRequest = ({
  fromWallet: {
    currencyConfig: { currencyInfo: { pluginId: 'thorchainrune' } }
  },
  toWallet: { currencyConfig: { currencyInfo: { pluginId: 'dash' } } },
  fromTokenId: null,
  toTokenId: null
} as unknown) as EdgeSwapRequestPlugin

// Real prices from midgard.mayachain.info. Maya lists a THOR.RUNE pool but no
// MAYA.CACAO pool, since it prices everything in CACAO.
const mayaPools = [
  { asset: 'BTC.BTC', assetPrice: '545667.63', assetPriceUSD: '65051.66' },
  {
    asset: 'THOR.RUNE',
    assetPrice: '3.578525528664948',
    assetPriceUSD: '0.42'
  },
  { asset: 'DASH.DASH', assetPrice: '276.94', assetPriceUSD: '33.01' },
  { asset: 'MAYA.MAYA', assetPrice: '1234.5', assetPriceUSD: '147.2' }
]

// Real shape from THORChain's midgard: no THOR.RUNE pool (everything is priced
// in RUNE), but THOR-native tokens do get their own pools.
const thorPools = [
  { asset: 'BTC.BTC', assetPrice: '152503.1', assetPriceUSD: '65051.66' },
  { asset: 'THOR.TCY', assetPrice: '0.0189', assetPriceUSD: '0.008' },
  {
    asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
    assetPrice: '2.34',
    assetPriceUSD: '1.00'
  }
]

describe(`getPool`, function () {
  // Maya treats RUNE as an ordinary bridged asset with a real pool. Pricing it
  // as a base asset (assetPrice '1') put the 'to' quote out by the whole
  // RUNE/CACAO ratio, about 3.58x here.
  it('maya prices RUNE from its real pool, not as a base asset', function () {
    const pool = getPool(
      fakeRequest,
      mayaSwapInfo,
      MAYA_NATIVE_CHAIN,
      'THOR',
      'RUNE',
      mayaPools
    )
    assert.equal(pool.asset, 'THOR.RUNE')
    assert.equal(pool.assetPrice, '3.578525528664948')
  })

  // THORChain lists no pool for its own base asset, so it still gets a
  // synthetic one priced at 1.
  it('thorchain synthesizes a RUNE pool priced at 1', function () {
    const pool = getPool(
      fakeRequest,
      thorSwapInfo,
      THORCHAIN_NATIVE_CHAIN,
      'THOR',
      'RUNE',
      thorPools
    )
    assert.equal(pool.asset, 'THOR.RUNE')
    assert.equal(pool.assetPrice, '1')
  })

  it('maya synthesizes a CACAO pool priced at 1', function () {
    const pool = getPool(
      fakeRequest,
      mayaSwapInfo,
      MAYA_NATIVE_CHAIN,
      'MAYA',
      'CACAO',
      mayaPools
    )
    assert.equal(pool.asset, 'MAYA.CACAO')
    assert.equal(pool.assetPrice, '1')
  })

  it('uses the real pool for a provider-native token', function () {
    const thorTcy = getPool(
      fakeRequest,
      thorSwapInfo,
      THORCHAIN_NATIVE_CHAIN,
      'THOR',
      'TCY',
      thorPools
    )
    assert.equal(thorTcy.assetPrice, '0.0189')
    const mayaMaya = getPool(
      fakeRequest,
      mayaSwapInfo,
      MAYA_NATIVE_CHAIN,
      'MAYA',
      'MAYA',
      mayaPools
    )
    assert.equal(mayaMaya.assetPrice, '1234.5')
  })

  it('matches a token pool despite its contract-address suffix', function () {
    const pool = getPool(
      fakeRequest,
      thorSwapInfo,
      THORCHAIN_NATIVE_CHAIN,
      'ETH',
      'USDC',
      thorPools
    )
    assert.equal(pool.assetPrice, '2.34')
  })

  it('throws for an asset with no pool', function () {
    assert.throws(
      () =>
        getPool(
          fakeRequest,
          mayaSwapInfo,
          MAYA_NATIVE_CHAIN,
          'LTC',
          'LTC',
          mayaPools
        ),
      /does not support/
    )
  })

  // CACAO is not a base asset to THORChain, so it must not be synthesized
  // there: it would price CACAO at 1 RUNE.
  it('does not synthesize another protocol base asset', function () {
    assert.throws(
      () =>
        getPool(
          fakeRequest,
          thorSwapInfo,
          THORCHAIN_NATIVE_CHAIN,
          'MAYA',
          'CACAO',
          thorPools
        ),
      /does not support/
    )
  })
})
