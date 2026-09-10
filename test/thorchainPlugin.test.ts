import { base64urlnopad, utf8 } from '@scure/base'
import { div, mul, round } from 'biggystring'
import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapPlugin,
  EdgeSwapRequest,
  EdgeTransaction
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeMayaProtocolPlugin } from '../src/swap/defi/thorchain/mayaprotocol'
import { makeThorchainPlugin } from '../src/swap/defi/thorchain/thorchain'
import { makeThorchainBasedPlugin } from '../src/swap/defi/thorchain/thorchainCommon'
import { ThorchainProviderOpts } from '../src/swap/defi/thorchain/thorchainTypes'
import { MakeTxParams } from '../src/swap/types'
import { div18 } from '../src/util/biggystringplus'

/**
 * Plugin-level behaviour pins for the shared Thorchain/Maya engine. Each case
 * quotes a real route through the public plugin factories against canned node
 * responses and asserts the exact spend or deposit the wallet is handed, so a
 * refactor of `thorchainCommon.ts` can be checked for byte-identical output.
 *
 * `fetchInfo` / `fetchWaterfall` arm 5 s timers that nothing clears, so mocha
 * exits a few seconds after the last case here. The EVM router path is not
 * covered: it builds calldata through ethers and is left to the type checker.
 */

const BTC_USER = 'bc1quser4cw7x46m2rxa78y32kv6nhzzssmvmpyfpcz'
const ETH_USER = '0x04c5998ded94f89263370444ce64a99b7dbc9f46'
const RUNE_USER = 'thor1useraxcnr8747pkanye45pnrwk7p9c3cqncsv'
const CACAO_USER = 'maya1useraxcnr8747pkanye45pnrwk7p9c3cqncsv'
const DASH_USER = 'XnzErKGuqcG5Ci5oTsQv7stwCBofgChu8s'
const XRP_USER = 'rUserGkqhF2dN1cLRXNmWq3yaSxuBpDbYxD'
const ZEC_UNIFIED =
  'u1userlpy2u0t9hdl8wcku8dmvrhwz6lk0jwj2z56ylxhacpn9jnx5sgftx8kv7s97ay37'
const ZEC_SAPLING =
  'zs1userhkwm0ayzqn99q04l6hhyy76cu6mf6m8cu4xv4pdles7a3puh2cnv7w32qhzk'
const ZEC_TRANSPARENT = 't1MnUkHpi3Ampr9ZzAtnWHFbatsVF3hEvKL'

const USDT_TOKEN_ID = 'dac17f958d2ee523a2206206994597c13d831ec7'
const TCY_TOKEN_ID = 'tcy'
const MAYA_TOKEN_ID = 'maya'

const THOR_UNITS = '100000000'

/** The wallet-side transaction fee every fake engine reports. */
const FAKE_NETWORK_FEE = '1000'

interface FakeInbound {
  chain: string
  address: string
  dust_threshold: string
  halted: boolean
  outbound_fee: string
  pub_key: string
  router?: string
  shielded_memo_config?: {
    enabled: boolean
    uivk: string
    unified_address: string
  }
}

const inbound = (
  chain: string,
  address: string,
  dustThreshold: string
): FakeInbound => ({
  chain,
  address,
  dust_threshold: dustThreshold,
  halted: false,
  outbound_fee: '1',
  pub_key: 'pub'
})

const THORCHAIN_INBOUND: FakeInbound[] = [
  inbound('BTC', 'bc1qthorvault28wunvj03uthp54dkeamp8mqdzw5q', '1000'),
  {
    ...inbound('ETH', '0x88e8def37dc9d2acd67f1c1574ad09ca49827374', '1000'),
    router: '0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146'
  },
  // XRP's threshold is served in THORChain's 1e8 units: 1 XRP.
  inbound('XRP', 'rThorVaultF2dN1cLRXNmWq3yaSxuBpDbYxD', '100000000')
]

const MAYA_ZEC_VAULT = 't1RBiXrLRdrHgsuSGQEusG2wCzPFczEVMfT'
const MAYA_ZEC_MEMO_RECIPIENT =
  'u1fcwchlpy2u0t9hdl8wcku8dmvrhwz6lk0jwj2z56ylxhacpn9jnx5sgftx8kv7s97ay37'
const MAYA_THOR_VAULT = 'thor1mayavault7pkanye45pnrwk7p9c3cqncsv'

const MAYA_INBOUND: FakeInbound[] = [
  inbound('BTC', 'bc1qmayavault8wunvj03uthp54dkeamp8mqdzw5q', '10000'),
  inbound('DASH', 'XmayaVaultqcG5Ci5oTsQv7stwCBofgChu8s', '10000'),
  inbound('THOR', MAYA_THOR_VAULT, '1'),
  {
    ...inbound('ZEC', MAYA_ZEC_VAULT, '10000'),
    shielded_memo_config: {
      enabled: true,
      uivk: 'uivk1mayaviewingkey',
      unified_address: MAYA_ZEC_MEMO_RECIPIENT
    }
  }
]

// Midgard's shape: THORChain prices everything in RUNE and lists no THOR.RUNE
// pool, but THOR-native tokens get their own pools.
const THORCHAIN_POOLS = [
  { asset: 'BTC.BTC', assetPrice: '152503.1', assetPriceUSD: '65051.66' },
  { asset: 'ETH.ETH', assetPrice: '5000', assetPriceUSD: '2100' },
  { asset: 'THOR.TCY', assetPrice: '0.0189', assetPriceUSD: '0.008' },
  { asset: 'XRP.XRP', assetPrice: '1.2', assetPriceUSD: '0.5' }
]

// Maya lists a real THOR.RUNE pool and no MAYA.CACAO pool.
const MAYA_RUNE_PRICE = '3.578525528664948'
const MAYA_DASH_PRICE = '276.94'
const MAYA_USDT_PRICE = '8.4'
const MAYA_POOLS = [
  { asset: 'BTC.BTC', assetPrice: '545667.63', assetPriceUSD: '65051.66' },
  { asset: 'THOR.RUNE', assetPrice: MAYA_RUNE_PRICE, assetPriceUSD: '0.42' },
  { asset: 'DASH.DASH', assetPrice: MAYA_DASH_PRICE, assetPriceUSD: '33.01' },
  {
    asset: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
    assetPrice: MAYA_USDT_PRICE,
    assetPriceUSD: '1.00'
  },
  { asset: 'ZEC.ZEC', assetPrice: '400', assetPriceUSD: '48' },
  { asset: 'MAYA.MAYA', assetPrice: '1234.5', assetPriceUSD: '147.2' }
]

type Provider = 'thorchain' | 'mayaprotocol'

interface FakeQuote {
  /** `expected_amount_out`, in the node's 1e8 units. */
  expectedAmountOut: string
  recommendedGasRate?: string
  gasRateUnits?: string
}

interface FakeIoLog {
  uris: string[]
}

interface FakeIoOpts {
  /** Replaces the provider's canned `inbound_addresses`. */
  inbound?: FakeInbound[]
  /** Replaces the provider's canned Midgard pools. */
  pools?: unknown[]
}

/**
 * Canned node responses. The info server is down so the plugin falls back to
 * its built-in defaults; the quote memo echoes the request the way thornode
 * does, with the limit left at 0 for the plugin to fill in.
 */
const makeFakeIo = (
  provider: Provider,
  quote: FakeQuote,
  log: FakeIoLog,
  opts: FakeIoOpts = {}
): { fetchCors: Function } => ({
  fetchCors: async (uri: string) => {
    log.uris.push(uri)

    const ok = (body: unknown): unknown => ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body)
    })

    if (uri.includes('/v1/exchangeInfo/')) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => 'not found'
      }
    }

    const inboundAddresses =
      opts.inbound ??
      (provider === 'thorchain' ? THORCHAIN_INBOUND : MAYA_INBOUND)
    if (uri.endsWith('/inbound_addresses')) return ok(inboundAddresses)

    if (uri.endsWith('/v2/pools')) {
      return ok(
        opts.pools ?? (provider === 'thorchain' ? THORCHAIN_POOLS : MAYA_POOLS)
      )
    }

    if (uri.includes('/quote/swap?')) {
      const params = new URL(uri).searchParams
      const fromChain = (params.get('from_asset') ?? '').split('.')[0]
      const inboundEntry = inboundAddresses.find(
        entry => entry.chain === fromChain
      )
      return ok({
        expected_amount_out: quote.expectedAmountOut,
        expiry: Math.floor(Date.now() / 1000) + 600,
        inbound_address: inboundEntry?.address,
        router: inboundEntry?.router,
        memo:
          `=:${params.get('to_asset') ?? ''}:${
            params.get('destination') ?? ''
          }` +
          `:0/${params.get('streaming_interval') ?? ''}/${
            params.get('streaming_quantity') ?? ''
          }` +
          `:${params.get('affiliate') ?? ''}:${
            params.get('affiliate_bps') ?? ''
          }`,
        recommended_min_amount_in: '1',
        recommended_gas_rate: quote.recommendedGasRate ?? '10',
        gas_rate_units: quote.gasRateUnits ?? 'satsperbyte',
        streaming_swap_blocks: 1,
        total_swap_seconds: 600
      })
    }

    throw new Error(`Unexpected fetch: ${uri}`)
  }
})

const makeLog = (): FakeIoLog => ({ uris: [] })

/** The `amount` query of every quote the plugin requested, in call order. */
const quoteAmounts = (log: FakeIoLog): string[] =>
  log.uris
    .filter(uri => uri.includes('/quote/swap?'))
    .map(uri => new URL(uri).searchParams.get('amount') ?? '')

const quoteParam = (log: FakeIoLog, name: string): string | null => {
  const uri = log.uris.find(uri => uri.includes('/quote/swap?'))
  if (uri == null) throw new Error('No quote was requested')
  return new URL(uri).searchParams.get(name)
}

const fakeLog = Object.assign(() => {}, { warn() {}, error() {} })

const makePlugin = (
  provider: Provider,
  quote: FakeQuote,
  log: FakeIoLog,
  opts: FakeIoOpts = {}
): EdgeSwapPlugin => {
  const pluginOpts = ({
    io: makeFakeIo(provider, quote, log, opts),
    initOptions: {},
    log: fakeLog
  } as unknown) as EdgeCorePluginOptions
  return provider === 'thorchain'
    ? makeThorchainPlugin(pluginOpts)
    : makeMayaProtocolPlugin(pluginOpts)
}

interface FakeAddress {
  addressType: string
  publicAddress: string
}

interface FakeToken {
  tokenId: string
  currencyCode: string
  multiplier: string
}

interface FakeWalletOpts {
  pluginId: string
  currencyCode: string
  multiplier: string
  addresses: FakeAddress[]
  tokens?: FakeToken[]
  balanceMap?: Map<string | null, string>
  /** Records every spend the plugin asks the engine to price. */
  spendLog?: EdgeSpendInfo[]
  /** Records every custom transaction the plugin asks the engine to build. */
  makeTxLog?: MakeTxParams[]
  /** What `getMaxTx` reports as the spendable maximum. */
  maxTx?: string
  getMaxTxLog?: MakeTxParams[]
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const {
    pluginId,
    currencyCode,
    multiplier,
    addresses,
    tokens = [],
    balanceMap = new Map(),
    spendLog = [],
    makeTxLog = [],
    maxTx = '0',
    getMaxTxLog = []
  } = opts

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

  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  }

  return ({
    id: `${pluginId}-wallet`,
    balanceMap,
    currencyInfo,
    currencyConfig: { currencyInfo, allTokens },
    async getAddresses() {
      return addresses
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo) {
      const balance = balanceMap.get(spendInfo.tokenId) ?? '0'
      return spendInfo.tokenId == null
        ? String(Number(balance) - Number(FAKE_NETWORK_FEE))
        : balance
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      spendLog.push(spendInfo)
      return ({
        networkFee: FAKE_NETWORK_FEE,
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId,
        currencyCode
      } as unknown) as EdgeTransaction
    },
    async nativeToDenomination(nativeAmount: string): Promise<string> {
      return div(nativeAmount, multiplier, multiplier.length)
    },
    otherMethods: {
      async makeTx(params: MakeTxParams): Promise<EdgeTransaction> {
        makeTxLog.push(params)
        if (params.type !== 'MakeTxDeposit') {
          throw new Error(`Unexpected makeTx type ${params.type}`)
        }
        return ({
          networkFee: FAKE_NETWORK_FEE,
          savedAction: params.savedAction,
          assetAction: params.assetAction,
          tokenId: null,
          currencyCode
        } as unknown) as EdgeTransaction
      },
      async getMaxTx(params: MakeTxParams): Promise<string> {
        getMaxTxLog.push(params)
        return maxTx
      }
    }
  } as unknown) as EdgeCurrencyWallet
}

const makeBtcWallet = (spendLog?: EdgeSpendInfo[]): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'bitcoin',
    currencyCode: 'BTC',
    multiplier: THOR_UNITS,
    addresses: [{ addressType: 'segwitAddress', publicAddress: BTC_USER }],
    spendLog
  })

const makeEthWallet = (): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'ethereum',
    currencyCode: 'ETH',
    multiplier: '1000000000000000000',
    addresses: [{ addressType: 'publicAddress', publicAddress: ETH_USER }],
    tokens: [
      { tokenId: USDT_TOKEN_ID, currencyCode: 'USDT', multiplier: '1000000' }
    ]
  })

const makeDashWallet = (spendLog?: EdgeSpendInfo[]): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'dash',
    currencyCode: 'DASH',
    multiplier: THOR_UNITS,
    addresses: [{ addressType: 'publicAddress', publicAddress: DASH_USER }],
    spendLog
  })

const makeXrpWallet = (): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'ripple',
    currencyCode: 'XRP',
    multiplier: '1000000',
    addresses: [{ addressType: 'publicAddress', publicAddress: XRP_USER }]
  })

/** The Zcash engine lists its unified address first. */
const makeZecWallet = (spendLog?: EdgeSpendInfo[]): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'zcash',
    currencyCode: 'ZEC',
    multiplier: THOR_UNITS,
    addresses: [
      { addressType: 'unifiedAddress', publicAddress: ZEC_UNIFIED },
      { addressType: 'saplingAddress', publicAddress: ZEC_SAPLING },
      { addressType: 'transparentAddress', publicAddress: ZEC_TRANSPARENT }
    ],
    spendLog
  })

interface CosmosWalletOpts {
  balanceMap?: Map<string | null, string>
  spendLog?: EdgeSpendInfo[]
  makeTxLog?: MakeTxParams[]
  getMaxTxLog?: MakeTxParams[]
  maxTx?: string
}

const makeRuneWallet = (opts: CosmosWalletOpts = {}): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'thorchainrune',
    currencyCode: 'RUNE',
    multiplier: THOR_UNITS,
    addresses: [{ addressType: 'publicAddress', publicAddress: RUNE_USER }],
    tokens: [
      { tokenId: TCY_TOKEN_ID, currencyCode: 'TCY', multiplier: THOR_UNITS }
    ],
    ...opts
  })

const makeCacaoWallet = (opts: CosmosWalletOpts = {}): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'mayachain',
    currencyCode: 'CACAO',
    multiplier: '10000000000',
    addresses: [{ addressType: 'publicAddress', publicAddress: CACAO_USER }],
    tokens: [
      { tokenId: MAYA_TOKEN_ID, currencyCode: 'MAYA', multiplier: '10000' }
    ],
    ...opts
  })

const fetchQuote = async (
  plugin: EdgeSwapPlugin,
  request: EdgeSwapRequest
): Promise<{ fromNativeAmount: string; toNativeAmount: string }> =>
  await plugin.fetchSwapQuote(request, undefined, { infoPayload: {} })

const expectError = async (
  promise: Promise<unknown>
): Promise<{ name: string; direction?: string }> => {
  try {
    await promise
  } catch (error: unknown) {
    return error as { name: string; direction?: string }
  }
  throw new Error('Expected the quote to throw')
}

const swapMemo = (toAsset: string, destination: string): string =>
  `=:${toAsset}:${destination}:0/1/1:ej:50`

describe('thorchain plugin', function () {
  it('sends BTC to the inbound vault with a text memo and the recommended fee', async function () {
    const log = makeLog()
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin(
      'thorchain',
      { expectedAmountOut: '314665730', recommendedGasRate: '7' },
      log
    )
    const quote = await fetchQuote(plugin, {
      fromWallet: makeBtcWallet(spendLog),
      fromTokenId: null,
      toWallet: makeEthWallet(),
      toTokenId: null,
      nativeAmount: '10000000',
      quoteFor: 'from'
    })

    assert.equal(quoteParam(log, 'amount'), '10000000')
    assert.equal(quoteParam(log, 'from_asset'), 'BTC.BTC')
    assert.equal(quoteParam(log, 'to_asset'), 'ETH.ETH')
    assert.equal(quoteParam(log, 'destination'), ETH_USER)
    assert.equal(quoteParam(log, 'affiliate'), 'ej')
    assert.equal(quoteParam(log, 'affiliate_bps'), '50')

    // 3.1466573 ETH, from the node's 1e8 units to wei.
    assert.equal(quote.fromNativeAmount, '10000000')
    assert.equal(quote.toNativeAmount, '3146657300000000000')

    assert.lengthOf(spendLog, 1)
    const [spendInfo] = spendLog
    assert.deepEqual(spendInfo.spendTargets, [
      {
        nativeAmount: '10000000',
        publicAddress: THORCHAIN_INBOUND[0].address
      }
    ])
    assert.deepEqual(spendInfo.memos, [
      { type: 'text', value: swapMemo('ETH.ETH', ETH_USER) }
    ])
    assert.equal(spendInfo.networkFeeOption, 'custom')
    assert.deepEqual(spendInfo.customNetworkFee, { satPerByte: '7' })
    // otherParams cross the WebView bridge as JSON, so compare them that way.
    assert.deepEqual(JSON.parse(JSON.stringify(spendInfo.otherParams)), {
      outputSort: 'targets'
    })
    assert.equal(spendInfo.savedAction?.actionType, 'swap')
    if (spendInfo.savedAction?.actionType !== 'swap') return
    assert.equal(spendInfo.savedAction.payoutAddress, ETH_USER)
    assert.equal(spendInfo.savedAction.isEstimate, true)
  })

  it('probes a RUNE max quote with 10 RUNE, then deposits what getMaxTx allows', async function () {
    const log = makeLog()
    const makeTxLog: MakeTxParams[] = []
    const getMaxTxLog: MakeTxParams[] = []
    const plugin = makePlugin('thorchain', { expectedAmountOut: '50000' }, log)
    const quote = await fetchQuote(plugin, {
      fromWallet: makeRuneWallet({
        balanceMap: new Map([[null, '5000000000']]),
        makeTxLog,
        getMaxTxLog,
        maxTx: '4990000000'
      }),
      fromTokenId: null,
      toWallet: makeBtcWallet(),
      toTokenId: null,
      nativeAmount: '0',
      quoteFor: 'max'
    })

    // Each quote round asks for a streaming and a non-streaming variant.
    assert.deepEqual(quoteAmounts(log), [
      '1000000000',
      '1000000000',
      '4990000000',
      '4990000000'
    ])
    assert.equal(quoteParam(log, 'from_asset'), 'THOR.RUNE')

    assert.lengthOf(getMaxTxLog, 1)
    assert.lengthOf(makeTxLog, 1)
    const [makeTxParams] = makeTxLog
    if (makeTxParams.type !== 'MakeTxDeposit') {
      throw new Error('Expected a deposit')
    }
    assert.deepEqual(makeTxParams.assets, [
      { amount: '4990000000', asset: 'THOR.RUNE', decimals: THOR_UNITS }
    ])
    assert.equal(makeTxParams.memo, swapMemo('BTC.BTC', BTC_USER))
    assert.equal(quote.fromNativeAmount, '4990000000')
  })

  it('deposits a THOR token, sizing a max swap through getMaxSwappable', async function () {
    const log = makeLog()
    const makeTxLog: MakeTxParams[] = []
    const getMaxTxLog: MakeTxParams[] = []
    const fromWallet = makeRuneWallet({
      balanceMap: new Map([[TCY_TOKEN_ID, '500000000']]),
      makeTxLog,
      getMaxTxLog,
      maxTx: '499000000'
    })
    const plugin = makePlugin('thorchain', { expectedAmountOut: '50000' }, log)

    await fetchQuote(plugin, {
      fromWallet,
      fromTokenId: TCY_TOKEN_ID,
      toWallet: makeBtcWallet(),
      toTokenId: null,
      nativeAmount: '100000000',
      quoteFor: 'from'
    })
    assert.equal(quoteParam(log, 'from_asset'), 'THOR.TCY')
    assert.deepEqual(
      makeTxLog[0].type === 'MakeTxDeposit' && makeTxLog[0].assets,
      [{ amount: '100000000', asset: 'THOR.TCY', decimals: THOR_UNITS }]
    )

    const maxLog = makeLog()
    const maxQuote = await fetchQuote(
      makePlugin('thorchain', { expectedAmountOut: '50000' }, maxLog),
      {
        fromWallet,
        fromTokenId: TCY_TOKEN_ID,
        toWallet: makeBtcWallet(),
        toTokenId: null,
        nativeAmount: '0',
        quoteFor: 'max'
      }
    )
    // The whole token balance is probed first, then getMaxTx sizes the deposit.
    assert.deepEqual(quoteAmounts(maxLog), [
      '500000000',
      '500000000',
      '499000000',
      '499000000'
    ])
    assert.lengthOf(getMaxTxLog, 1)
    assert.equal(maxQuote.fromNativeAmount, '499000000')
  })

  it('rejects an XRP amount below the served dust threshold', async function () {
    const log = makeLog()
    const plugin = makePlugin('thorchain', { expectedAmountOut: '1' }, log)
    const error = await expectError(
      fetchQuote(plugin, {
        fromWallet: makeXrpWallet(),
        fromTokenId: null,
        toWallet: makeBtcWallet(),
        toTokenId: null,
        nativeAmount: '500000',
        quoteFor: 'from'
      })
    )
    assert.equal(error.name, 'SwapBelowLimitError')
    assert.equal(error.direction, 'from')
    assert.lengthOf(quoteAmounts(log), 0)
  })

  it('rejects a Zcash source before touching the network', async function () {
    const log = makeLog()
    const plugin = makePlugin('thorchain', { expectedAmountOut: '1' }, log)
    const error = await expectError(
      fetchQuote(plugin, {
        fromWallet: makeZecWallet(),
        fromTokenId: null,
        toWallet: makeBtcWallet(),
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      })
    )
    assert.equal(error.name, 'SwapCurrencyError')
    assert.lengthOf(log.uris, 0)
  })
})

describe('mayaprotocol plugin', function () {
  it('deposits CACAO in its native 1e10 precision', async function () {
    const log = makeLog()
    const makeTxLog: MakeTxParams[] = []
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '500000' },
      log
    )
    const quote = await fetchQuote(plugin, {
      fromWallet: makeCacaoWallet({ makeTxLog }),
      fromTokenId: null,
      toWallet: makeBtcWallet(),
      toTokenId: null,
      nativeAmount: '9420000000000',
      quoteFor: 'from'
    })

    assert.equal(quoteParam(log, 'amount'), '9420000000000')
    assert.equal(quoteParam(log, 'from_asset'), 'MAYA.CACAO')
    assert.lengthOf(makeTxLog, 1)
    const [makeTxParams] = makeTxLog
    if (makeTxParams.type !== 'MakeTxDeposit') {
      throw new Error('Expected a deposit')
    }
    assert.deepEqual(makeTxParams.assets, [
      { amount: '9420000000000', asset: 'MAYA.CACAO', decimals: '10000000000' }
    ])
    assert.equal(makeTxParams.memo, swapMemo('BTC.BTC', BTC_USER))
    // 0.005 BTC from the node's 1e8 units.
    assert.equal(quote.toNativeAmount, '500000')
  })

  it('probes a CACAO max quote with 1000 CACAO', async function () {
    const log = makeLog()
    const getMaxTxLog: MakeTxParams[] = []
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '500000' },
      log
    )
    const quote = await fetchQuote(plugin, {
      fromWallet: makeCacaoWallet({
        balanceMap: new Map([[null, '10000000000000']]),
        getMaxTxLog,
        maxTx: '9990000000000'
      }),
      fromTokenId: null,
      toWallet: makeBtcWallet(),
      toTokenId: null,
      nativeAmount: '0',
      quoteFor: 'max'
    })

    assert.deepEqual(quoteAmounts(log), [
      '10000000000000',
      '10000000000000',
      '9990000000000',
      '9990000000000'
    ])
    assert.lengthOf(getMaxTxLog, 1)
    assert.equal(quote.fromNativeAmount, '9990000000000')
  })

  it('sends RUNE to its THOR inbound vault instead of depositing it', async function () {
    const log = makeLog()
    const spendLog: EdgeSpendInfo[] = []
    const makeTxLog: MakeTxParams[] = []
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '100000000' },
      log
    )
    await fetchQuote(plugin, {
      fromWallet: makeRuneWallet({ spendLog, makeTxLog }),
      fromTokenId: null,
      toWallet: makeDashWallet(),
      toTokenId: null,
      nativeAmount: '1000000000',
      quoteFor: 'from'
    })

    assert.equal(quoteParam(log, 'from_asset'), 'THOR.RUNE')
    assert.lengthOf(makeTxLog, 0)
    assert.lengthOf(spendLog, 1)
    const [spendInfo] = spendLog
    assert.deepEqual(spendInfo.spendTargets, [
      { nativeAmount: '1000000000', publicAddress: MAYA_THOR_VAULT }
    ])
    assert.deepEqual(spendInfo.memos, [
      { type: 'text', value: swapMemo('DASH.DASH', DASH_USER) }
    ])
  })

  it('prices a RUNE source from the real THOR.RUNE pool on a to-quote', async function () {
    const log = makeLog()
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '100000000' },
      log
    )
    const quote = await fetchQuote(plugin, {
      fromWallet: makeRuneWallet(),
      fromTokenId: null,
      toWallet: makeDashWallet(),
      toTokenId: null,
      nativeAmount: '100000000',
      quoteFor: 'to'
    })

    // 1 DASH converted through the pool prices, ~77.39 RUNE.
    const requestedFromThorAmount = round(
      mul(mul('1', div18(MAYA_DASH_PRICE, MAYA_RUNE_PRICE)), THOR_UNITS),
      0
    )
    assert.equal(quoteParam(log, 'amount'), requestedFromThorAmount)
    assert.equal(quote.fromNativeAmount, requestedFromThorAmount)
    assert.equal(quote.toNativeAmount, '100000000')
  })

  it('normalizes a bridged token destination to 1e8 on a to-quote', async function () {
    const log = makeLog()
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '263000000' },
      log
    )
    const quote = await fetchQuote(plugin, {
      fromWallet: makeDashWallet(),
      fromTokenId: null,
      toWallet: makeEthWallet(),
      toTokenId: USDT_TOKEN_ID,
      nativeAmount: '2630000',
      quoteFor: 'to'
    })

    // 2.63 USDT converted through the pool prices. Had the node been assumed
    // to quote USDT in its native 1e6, the fee ratio would be off by 100x.
    const requestedFromThorAmount = round(
      mul(mul('2.63', div18(MAYA_USDT_PRICE, MAYA_DASH_PRICE)), THOR_UNITS),
      0
    )
    assert.equal(quoteParam(log, 'amount'), requestedFromThorAmount)
    assert.equal(quote.fromNativeAmount, requestedFromThorAmount)
    assert.equal(quote.toNativeAmount, '2630000')
  })

  it('carries the Zcash memo and refund address in a shielded ZIP-321 note', async function () {
    const log = makeLog()
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '250000' },
      log
    )
    await fetchQuote(plugin, {
      fromWallet: makeZecWallet(spendLog),
      fromTokenId: null,
      toWallet: makeBtcWallet(),
      toTokenId: null,
      nativeAmount: '123456789',
      quoteFor: 'from'
    })

    assert.equal(quoteParam(log, 'destination'), BTC_USER)
    assert.lengthOf(spendLog, 1)
    const [spendInfo] = spendLog

    const memo = `=:BTC.BTC:${BTC_USER}/${ZEC_TRANSPARENT}:0/1/1:ej:50`
    const expectedUri =
      `zcash:?address=${MAYA_ZEC_VAULT}` +
      '&amount=1.23456789' +
      `&address.1=${MAYA_ZEC_MEMO_RECIPIENT}` +
      '&amount.1=0' +
      `&memo.1=${base64urlnopad.encode(utf8.decode(memo))}`
    assert.deepEqual(spendInfo.otherParams, {
      outputSort: 'targets',
      zip321Uri: expectedUri
    })
    assert.deepEqual(spendInfo.spendTargets, [
      { nativeAmount: '123456789', publicAddress: MAYA_ZEC_VAULT }
    ])
    assert.deepEqual(spendInfo.memos, [{ type: 'text', value: '' }])
    assert.equal(spendInfo.networkFeeOption, 'high')
  })

  it('refuses a Zcash source when the vault advertises no shielded memo address', async function () {
    const log = makeLog()
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '250000' },
      log,
      {
        inbound: MAYA_INBOUND.map(entry =>
          entry.chain === 'ZEC'
            ? inbound('ZEC', MAYA_ZEC_VAULT, '10000')
            : entry
        )
      }
    )
    const error = await expectError(
      fetchQuote(plugin, {
        fromWallet: makeZecWallet(),
        fromTokenId: null,
        toWallet: makeBtcWallet(),
        toTokenId: null,
        nativeAmount: '123456789',
        quoteFor: 'from'
      })
    )
    assert.equal(error.name, 'SwapCurrencyError')
  })

  it('pays out Zcash to the transparent address, not the unified one', async function () {
    const log = makeLog()
    const spendLog: EdgeSpendInfo[] = []
    const plugin = makePlugin(
      'mayaprotocol',
      { expectedAmountOut: '400000000' },
      log
    )
    await fetchQuote(plugin, {
      fromWallet: makeBtcWallet(spendLog),
      fromTokenId: null,
      toWallet: makeZecWallet(),
      toTokenId: null,
      nativeAmount: '1000000',
      quoteFor: 'from'
    })

    assert.equal(quoteParam(log, 'destination'), ZEC_TRANSPARENT)
    const [spendInfo] = spendLog
    assert.equal(spendInfo.savedAction?.actionType, 'swap')
    if (spendInfo.savedAction?.actionType !== 'swap') return
    assert.equal(spendInfo.savedAction.payoutAddress, ZEC_TRANSPARENT)
  })
})

/**
 * A THORChain-shaped provider that lists Zcash but injects no Zcash send
 * strategy, to show what the profile alone does with a Zcash source.
 */
const makeSyntheticPlugin = (
  log: FakeIoLog,
  overrides: Partial<ThorchainProviderOpts> = {}
): EdgeSwapPlugin =>
  makeThorchainBasedPlugin(
    ({
      io: makeFakeIo('thorchain', { expectedAmountOut: '250000' }, log, {
        inbound: [
          ...THORCHAIN_INBOUND,
          inbound('ZEC', 't1ThorVaultHpi3Ampr9ZzAtnWHFbatsVF3hEv', '15000')
        ],
        pools: [
          ...THORCHAIN_POOLS,
          { asset: 'ZEC.ZEC', assetPrice: '400', assetPriceUSD: '48' }
        ]
      }),
      initOptions: {},
      log: fakeLog
    } as unknown) as EdgeCorePluginOptions,
    {
      swapInfo: {
        pluginId: 'synthetic',
        isDex: true,
        displayName: 'Synthetic',
        supportEmail: 'support@edge.app'
      },
      orderUri: 'https://example.invalid/{{TXID}}',
      MAINNET_CODE_TRANSCRIPTION: { bitcoin: 'BTC', zcash: 'ZEC' },
      MIDGARD_SERVERS_DEFAULT: ['https://midgard.example.invalid'],
      THORNODE_SERVERS_DEFAULT: ['https://thornode.example.invalid'],
      infoServer: { exchangeInfo: undefined, exchangeInfoLastUpdate: 0 },
      nativeChain: {
        pluginId: 'thorchainrune',
        baseAsset: 'THOR.RUNE',
        ownAssetsUseNativePrecision: false,
        maxQuoteSeedExchangeAmount: '10'
      },
      ...overrides
    }
  )

describe('provider profile', function () {
  it('excludes a source chain through invalidTokenIds before any fetch', async function () {
    const log = makeLog()
    const plugin = makeSyntheticPlugin(log, {
      invalidTokenIds: { from: { zcash: 'allCodes' }, to: {} }
    })
    const error = await expectError(
      fetchQuote(plugin, {
        fromWallet: makeZecWallet(),
        fromTokenId: null,
        toWallet: makeBtcWallet(),
        toTokenId: null,
        nativeAmount: '123456789',
        quoteFor: 'from'
      })
    )
    assert.equal(error.name, 'SwapCurrencyError')
    assert.lengthOf(log.uris, 0)
  })

  it('keeps the shared exclusions alongside the provider ones', async function () {
    const log = makeLog()
    const plugin = makeSyntheticPlugin(log, {
      MAINNET_CODE_TRANSCRIPTION: {
        bitcoin: 'BTC',
        zcash: 'ZEC',
        optimism: 'OP'
      },
      invalidTokenIds: { from: { zcash: 'allCodes' }, to: {} }
    })
    // VELO on Optimism is blocked for every Thorchain-based plugin.
    const veloTokenId = '9560e827af36c94d2ac33a39bce1fe78631088db'
    const error = await expectError(
      fetchQuote(plugin, {
        fromWallet: makeFakeWallet({
          pluginId: 'optimism',
          currencyCode: 'ETH',
          multiplier: '1000000000000000000',
          addresses: [
            { addressType: 'publicAddress', publicAddress: ETH_USER }
          ],
          tokens: [
            {
              tokenId: veloTokenId,
              currencyCode: 'VELO',
              multiplier: '1000000000000000000'
            }
          ]
        }),
        fromTokenId: veloTokenId,
        toWallet: makeBtcWallet(),
        toTokenId: null,
        nativeAmount: '1000000000000000000',
        quoteFor: 'from'
      })
    )
    assert.equal(error.name, 'SwapCurrencyError')
    assert.lengthOf(log.uris, 0)
  })

  it('falls back to a plain text-memo send for a chain with no strategy', async function () {
    // Documents that the exclusion, not the missing strategy, is what keeps a
    // shielded Zcash source away from a provider that cannot read its memo.
    const log = makeLog()
    const spendLog: EdgeSpendInfo[] = []
    await fetchQuote(makeSyntheticPlugin(log), {
      fromWallet: makeZecWallet(spendLog),
      fromTokenId: null,
      toWallet: makeBtcWallet(),
      toTokenId: null,
      nativeAmount: '123456789',
      quoteFor: 'from'
    })

    assert.lengthOf(spendLog, 1)
    const [spendInfo] = spendLog
    assert.deepEqual(spendInfo.memos, [
      { type: 'text', value: swapMemo('BTC.BTC', BTC_USER) }
    ])
    assert.deepEqual(spendInfo.otherParams, { outputSort: 'targets' })
    assert.equal(
      spendInfo.spendTargets[0].publicAddress,
      't1ThorVaultHpi3Ampr9ZzAtnWHFbatsVF3hEv'
    )
  })
})
