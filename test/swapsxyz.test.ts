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

import {
  makeSwapsXyzPlugin,
  makeSwapsXyzSpendInfo,
  SwapsXyzAction
} from '../src/swap/defi/swapsxyz'

const USDC = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDT = 'dac17f958d2ee523a2206206994597c13d831ec7'
// A token that resolves in the wallet but carries no on-chain contract
// address, exercising the plugin's "no address to send to" guard.
const NO_CONTRACT = 'ffffffffffffffffffffffffffffffffffffffff'
const ROUTER = '0x1b6257CAE4192e62B629eFCa21771be3D759183D'
const SENDER = '0x0b0901e9cef9eaed5753519177e3c7cfd0ef96ef'
const RECIPIENT = '0x1234567890123456789012345678901234567890'

const makeAmount = (
  amount: string,
  address: string,
  isNative: boolean,
  decimals: number,
  symbol: string
): SwapsXyzAction['amountIn'] => ({
  amount,
  address,
  chainId: 1,
  isNative,
  decimals,
  symbol
})

describe('swapsxyz makeSwapsXyzSpendInfo', function () {
  it('native ethereum to usdc token', function () {
    const action: SwapsXyzAction = {
      tx: {
        to: ROUTER,
        data: '0x9be111d1deadbeef',
        value: '10000000000000000',
        chainId: 1
      },
      txId: '0x99b16cbed2445ffdc34133e030cdda451bcdd73c',
      amountIn: makeAmount(
        '10000000000000000',
        '0x0000000000000000000000000000000000000000',
        true,
        18,
        'ETH'
      ),
      amountOut: makeAmount('19156417', `0x${USDC}`, false, 6, 'USDC'),
      amountOutMin: makeAmount('18964852', `0x${USDC}`, false, 6, 'USDC'),
      vmId: 'evm',
      requiresTokenApproval: false,
      executionsType: 'DEFAULT'
    }

    const spendInfo = makeSwapsXyzSpendInfo({
      action,
      fromPluginId: 'ethereum',
      toPluginId: 'ethereum',
      fromTokenId: null,
      toTokenId: USDC,
      fromAddress: SENDER,
      toAddress: RECIPIENT,
      toWalletId: 'wallet-eth'
    })

    assert.deepEqual(spendInfo, {
      tokenId: null,
      // Native source: the wallet must forward tx.value with the calldata.
      spendTargets: [
        { nativeAmount: '10000000000000000', publicAddress: ROUTER }
      ],
      memos: [{ type: 'hex', value: '9be111d1deadbeef' }],
      networkFeeOption: 'high',
      assetAction: { assetActionType: 'swap' },
      savedAction: {
        actionType: 'swap',
        swapInfo: {
          pluginId: 'swapsxyz',
          isDex: true,
          displayName: 'swaps.xyz',
          supportEmail: 'support@edge.app'
        },
        orderId: '0x99b16cbed2445ffdc34133e030cdda451bcdd73c',
        orderUri:
          'https://explorer.swaps.xyz/tx/0x99b16cbed2445ffdc34133e030cdda451bcdd73c',
        isEstimate: true,
        toAsset: {
          pluginId: 'ethereum',
          tokenId: USDC,
          nativeAmount: '19156417'
        },
        fromAsset: {
          pluginId: 'ethereum',
          tokenId: null,
          nativeAmount: '10000000000000000'
        },
        payoutAddress: RECIPIENT,
        payoutWalletId: 'wallet-eth',
        refundAddress: SENDER
      }
    })
  })

  it('usdc token to usdt token', function () {
    const action: SwapsXyzAction = {
      tx: {
        to: ROUTER,
        data: '0x9be111d1cafe',
        value: '0',
        chainId: 1
      },
      txId: '0xbd5a71f0d86a654a5bb8ed647cf2a9d2f27629ba',
      amountIn: makeAmount('100000000', `0x${USDC}`, false, 6, 'USDC'),
      amountOut: makeAmount('100054660', `0x${USDT}`, false, 6, 'USDT'),
      amountOutMin: makeAmount('99054113', `0x${USDT}`, false, 6, 'USDT'),
      vmId: 'evm',
      requiresTokenApproval: true,
      executionsType: 'DEFAULT'
    }

    const spendInfo = makeSwapsXyzSpendInfo({
      action,
      fromPluginId: 'ethereum',
      toPluginId: 'ethereum',
      fromTokenId: USDC,
      toTokenId: USDT,
      fromAddress: SENDER,
      toAddress: SENDER,
      toWalletId: 'wallet-eth'
    })

    // Token source: nativeAmount is the ERC20 amount (tx.value is 0) and the
    // spend is scoped to the source tokenId.
    assert.strictEqual(spendInfo.tokenId, USDC)
    assert.deepEqual(spendInfo.spendTargets, [
      { nativeAmount: '100000000', publicAddress: ROUTER }
    ])
    assert.deepEqual(spendInfo.memos, [{ type: 'hex', value: '9be111d1cafe' }])
    const savedAction = spendInfo.savedAction
    assert.isNotNull(savedAction)
    if (savedAction != null && savedAction.actionType === 'swap') {
      assert.strictEqual(savedAction.fromAsset.nativeAmount, '100000000')
      assert.strictEqual(savedAction.toAsset.nativeAmount, '100054660')
      assert.strictEqual(savedAction.orderId, action.txId)
    }
  })
})

// ---------------------------------------------------------------------------
// End-to-end error-condition coverage
//
// These drive the real `fetchSwapQuote` with a faked `io.fetchCors` and faked
// wallets (mirroring test/nym.test.ts) so the guard logic and the getAction
// error classification are exercised through the actual plugin, asserting the
// TYPED swap errors edge-core-js ranks. Each swap error subclass has a distinct
// `.name`, which is what the assertions key on.
// ---------------------------------------------------------------------------

interface FakeWalletOpts {
  pluginId: string
  currencyCode: string
  address: string
  /** Balances keyed by tokenId (or `null` for the native asset). */
  balanceMap?: Map<string | null, string>
}

const TOKENS: {
  [tokenId: string]: { currencyCode: string; contractAddress?: string }
} = {
  [USDC]: { currencyCode: 'USDC', contractAddress: `0x${USDC}` },
  [USDT]: { currencyCode: 'USDT', contractAddress: `0x${USDT}` },
  // Resolvable currencyCode, but no contractAddress on its networkLocation.
  [NO_CONTRACT]: { currencyCode: 'NOC' }
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const { address, balanceMap = new Map(), currencyCode, pluginId } = opts

  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier: '1000000000000000000' }]
  }

  const allTokens: {
    [tokenId: string]: {
      currencyCode: string
      denominations: Array<{ name: string; multiplier: string }>
      networkLocation: { contractAddress?: string }
    }
  } = {}
  for (const tokenId of Object.keys(TOKENS)) {
    const { currencyCode: code, contractAddress } = TOKENS[tokenId]
    allTokens[tokenId] = {
      currencyCode: code,
      denominations: [{ name: code, multiplier: '1000000' }],
      networkLocation: { contractAddress }
    }
  }

  return ({
    id: `${pluginId}-wallet`,
    balanceMap,
    currencyInfo,
    currencyConfig: {
      // `SwapCurrencyError` reads the pluginId through here.
      currencyInfo,
      allTokens
    },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo) {
      return balanceMap.get(spendInfo.tokenId) ?? '0'
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      return ({
        networkFee: '0',
        parentNetworkFee: '21000000000000',
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      } as unknown) as EdgeTransaction
    }
  } as unknown) as EdgeCurrencyWallet
}

/** A getAction response body plus the HTTP metadata to return it with. */
interface FakeResponse {
  body: unknown
  ok?: boolean
  status?: number
}

/**
 * A `getPaths` body offering an unlimited exact-amount-in route to the
 * destination chain. Every quote now calls `getPaths` before `getAction`, so
 * the getAction-focused tests serve this permissive default.
 */
const openPaths = (
  overrides: {
    paths?: unknown[]
    srcToken?: { minAmount?: string | null; maxAmount?: string | null }
  } = {}
): FakeResponse => ({
  body: {
    srcChainId: 1,
    srcToken: { minAmount: null, maxAmount: null, ...overrides.srcToken },
    paths: overrides.paths ?? [
      {
        chainId: 1,
        tokens: 'all',
        supportsExactAmountIn: true,
        supportsExactAmountOut: true,
        amountLimits: { minAmount: null, maxAmount: null }
      }
    ]
  }
})

const makeFakeIo = (
  actionResponse: FakeResponse,
  pathsResponse: FakeResponse
): { fetchCors: Function } => ({
  fetchCors: async (uri: string, _opts: unknown) => {
    const { body, ok = true, status = 200 } = uri.includes('/getPaths')
      ? pathsResponse
      : actionResponse
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    }
  }
})

const makePlugin = (
  response: FakeResponse,
  pathsResponse: FakeResponse = openPaths()
): EdgeSwapPlugin =>
  makeSwapsXyzPlugin(({
    io: makeFakeIo(response, pathsResponse),
    initOptions: { apiKey: 'test-key' },
    log: { warn() {} }
  } as unknown) as EdgeCorePluginOptions)

/** A getAction error body: `{ success: false, error: { code, message } }`. */
const errorBody = (code: string, message = ''): FakeResponse => ({
  body: { success: false, error: { code, message } },
  ok: false,
  status: 400
})

const ethWallet = (
  balanceMap?: Map<string | null, string>
): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'ethereum',
    currencyCode: 'ETH',
    address: SENDER,
    balanceMap
  })

const usdcRequest = (
  overrides: Partial<EdgeSwapRequest> = {}
): EdgeSwapRequest => ({
  fromWallet: ethWallet(new Map([[null, '1000000000000000000']])),
  fromTokenId: null,
  toWallet: makeFakeWallet({
    pluginId: 'ethereum',
    currencyCode: 'ETH',
    address: RECIPIENT
  }),
  toTokenId: USDC,
  nativeAmount: '10000000000000000',
  quoteFor: 'from',
  ...overrides
})

const expectErrorName = async (
  plugin: EdgeSwapPlugin,
  request: EdgeSwapRequest,
  expectedName: string
): Promise<void> => {
  await plugin.fetchSwapQuote(request, undefined, { infoPayload: {} }).then(
    () => assert.fail(`expected ${expectedName}`),
    (error: unknown) => assert.equal((error as Error).name, expectedName)
  )
}

// An otherwise-valid getAction success body, reused by the success-guard tests.
const okAction = (overrides: Partial<SwapsXyzAction> = {}): FakeResponse => ({
  body: {
    tx: {
      to: ROUTER,
      data: '0x9be111d1deadbeef',
      value: '10000000000000000',
      chainId: 1
    },
    txId: '0x99b16cbed2445ffdc34133e030cdda451bcdd73c',
    amountIn: makeAmount(
      '10000000000000000',
      '0x0000000000000000000000000000000000000000',
      true,
      18,
      'ETH'
    ),
    amountOut: makeAmount('19156417', `0x${USDC}`, false, 6, 'USDC'),
    amountOutMin: makeAmount('18964852', `0x${USDC}`, false, 6, 'USDC'),
    vmId: 'evm',
    requiresTokenApproval: false,
    executionsType: 'DEFAULT',
    ...overrides
  }
})

describe('swapsxyz fetchSwapQuote guards (no network)', function () {
  it('rejects a non-"from" quote direction with SwapCurrencyError', async function () {
    // getAction only builds an exact-source-amount route; 'to' is unsupported.
    const plugin = makePlugin(okAction())
    await expectErrorName(
      plugin,
      usdcRequest({ quoteFor: 'to' }),
      'SwapCurrencyError'
    )
  })

  it('rejects a same-asset swap with SwapCurrencyError', async function () {
    const wallet = ethWallet(new Map([[null, '1000000000000000000']]))
    const plugin = makePlugin(okAction())
    await expectErrorName(
      plugin,
      usdcRequest({ fromWallet: wallet, toWallet: wallet, toTokenId: null }),
      'SwapCurrencyError'
    )
  })

  it('rejects an unmapped source chain with SwapCurrencyError', async function () {
    // bitcoin is not in the EVM chain mapping, so no route can exist.
    const bitcoin = makeFakeWallet({
      pluginId: 'bitcoin',
      currencyCode: 'BTC',
      address: 'bc1qexampleexampleexampleexampleexampleexxx',
      balanceMap: new Map([[null, '100000000']])
    })
    const plugin = makePlugin(okAction())
    await expectErrorName(
      plugin,
      usdcRequest({ fromWallet: bitcoin, fromTokenId: null }),
      'SwapCurrencyError'
    )
  })

  it('rejects a source token with no contract address with SwapCurrencyError', async function () {
    // The token resolves in the wallet but exposes no on-chain contract
    // address, so there is nothing to hand swaps.xyz as the source token.
    const plugin = makePlugin(okAction())
    await expectErrorName(
      plugin,
      usdcRequest({ fromTokenId: NO_CONTRACT }),
      'SwapCurrencyError'
    )
  })
})

describe('swapsxyz fetchSwapQuote getPaths pre-check', function () {
  it('rejects a pair with no route (empty paths) with SwapCurrencyError', async function () {
    // swaps.xyz reports an unroutable pair as HTTP 200 with `paths: []`, which
    // is also how a chain mapped for futureproofing but not yet offered looks.
    await expectErrorName(
      makePlugin(okAction(), openPaths({ paths: [] })),
      usdcRequest(),
      'SwapCurrencyError'
    )
  })

  it('rejects a route that cannot do exact-amount-in with SwapCurrencyError', async function () {
    // The plugin only quotes an exact source amount.
    await expectErrorName(
      makePlugin(
        okAction(),
        openPaths({
          paths: [{ chainId: 1, supportsExactAmountIn: false }]
        })
      ),
      usdcRequest(),
      'SwapCurrencyError'
    )
  })

  it('throws SwapBelowLimitError before getAction when under the route minimum', async function () {
    // Limits are base-unit strings on the source token; the request sends
    // 0.01 ETH against a 0.05 ETH minimum.
    await expectErrorName(
      makePlugin(
        okAction(),
        openPaths({
          paths: [
            {
              chainId: 1,
              supportsExactAmountIn: true,
              amountLimits: {
                minAmount: '50000000000000000',
                maxAmount: null
              }
            }
          ]
        })
      ),
      usdcRequest(),
      'SwapBelowLimitError'
    )
  })

  it('throws SwapAboveLimitError before getAction when over the route maximum', async function () {
    await expectErrorName(
      makePlugin(
        okAction(),
        openPaths({
          paths: [
            {
              chainId: 1,
              supportsExactAmountIn: true,
              amountLimits: {
                minAmount: null,
                maxAmount: '1000000000000000'
              }
            }
          ]
        })
      ),
      usdcRequest(),
      'SwapAboveLimitError'
    )
  })

  it('falls back to the source token limits when the route carries none', async function () {
    await expectErrorName(
      makePlugin(
        okAction(),
        openPaths({
          srcToken: { minAmount: '50000000000000000', maxAmount: null },
          paths: [{ chainId: 1, supportsExactAmountIn: true }]
        })
      ),
      usdcRequest(),
      'SwapBelowLimitError'
    )
  })

  it('clamps a max request to the route ceiling instead of failing', async function () {
    // A `max` quote arrives as a `from` quote for the whole balance. A wallet
    // richer than the route's ceiling must quote AT the ceiling; only an
    // explicit over-limit amount is an error.
    const wallet = ethWallet(new Map([[USDC, '10000000']]))
    const quote = await makePlugin(
      // The response echoes the CLAMPED source amount, as the live API does.
      okAction({
        tx: {
          to: ROUTER,
          data: '0x9be111d1deadbeef',
          value: '0',
          chainId: 1
        },
        amountIn: makeAmount('5000000', `0x${USDC}`, false, 6, 'USDC')
      }),
      openPaths({
        paths: [
          {
            chainId: 1,
            supportsExactAmountIn: true,
            amountLimits: { minAmount: null, maxAmount: '5000000' }
          }
        ]
      })
    ).fetchSwapQuote(
      usdcRequest({
        fromWallet: wallet,
        fromTokenId: USDC,
        toTokenId: USDT,
        quoteFor: 'max'
      }),
      undefined,
      { infoPayload: {} }
    )
    assert.equal(quote.fromNativeAmount, '5000000')
  })

  it('surfaces a getPaths error body with the endpoint named', async function () {
    const plugin = makePlugin(
      okAction(),
      errorBody('INTERNAL_SERVER_ERROR', 'boom')
    )
    await plugin
      .fetchSwapQuote(usdcRequest(), undefined, { infoPayload: {} })
      .then(
        () => assert.fail('expected a plain Error'),
        (error: unknown) => {
          assert.equal((error as Error).name, 'Error')
          assert.include((error as Error).message, 'getPaths')
        }
      )
  })
})

describe('swapsxyz fetchSwapQuote getAction error classification', function () {
  it('maps a below-minimum error code to SwapBelowLimitError', async function () {
    await expectErrorName(
      makePlugin(errorBody('AMOUNT_TOO_LOW', 'Amount is below the minimum')),
      usdcRequest(),
      'SwapBelowLimitError'
    )
  })

  it('maps an above-maximum error code to SwapAboveLimitError', async function () {
    await expectErrorName(
      makePlugin(errorBody('AMOUNT_EXCEEDS_MAXIMUM', 'Amount is too large')),
      usdcRequest(),
      'SwapAboveLimitError'
    )
  })

  it('maps an unsupported-route error code to SwapCurrencyError', async function () {
    await expectErrorName(
      makePlugin(errorBody('NO_ROUTE_FOUND', 'No route for this pair')),
      usdcRequest(),
      'SwapCurrencyError'
    )
  })

  it('maps an unsupported-token error code to SwapCurrencyError', async function () {
    await expectErrorName(
      makePlugin(errorBody('INVALID_SOURCE_TOKEN')),
      usdcRequest(),
      'SwapCurrencyError'
    )
  })

  it('ranks a limit failure as a limit error even when it names the route', async function () {
    // Limit keywords are checked before the currency keywords, so a message
    // mentioning the route does not hide the actionable below-limit error.
    await expectErrorName(
      makePlugin(errorBody('NO_QUOTE', 'Amount too low for this route')),
      usdcRequest(),
      'SwapBelowLimitError'
    )
  })

  it('does not read ALLOWANCE as a below-limit error', async function () {
    // 'ALLOWANCE' contains the substring 'LOW'; matching whole phrases keeps it
    // out of the limit buckets.
    const plugin = makePlugin(errorBody('ALLOWANCE_REQUIRED', 'Set allowance'))
    await plugin
      .fetchSwapQuote(usdcRequest(), undefined, { infoPayload: {} })
      .then(
        () => assert.fail('expected a plain Error'),
        (error: unknown) => assert.equal((error as Error).name, 'Error')
      )
  })

  it('rejects a response whose source amount exceeds the request', async function () {
    // The spend and approval are built from response fields, so a larger
    // amountIn than requested must never reach a signed transaction.
    const plugin = makePlugin(
      okAction({
        amountIn: makeAmount(
          '99000000000000000',
          '0x0000000000000000000000000000000000000000',
          true,
          18,
          'ETH'
        )
      })
    )
    await plugin
      .fetchSwapQuote(usdcRequest(), undefined, { infoPayload: {} })
      .then(
        () => assert.fail('expected a plain Error'),
        (error: unknown) => {
          assert.equal((error as Error).name, 'Error')
          assert.include((error as Error).message, 'above the requested amount')
        }
      )
  })

  it("does not compare a token route's native tx.value against the token amount", async function () {
    // On an ERC20 source `tx.value` is a native-wei protocol fee, a different
    // unit from the token `swapAmount`, so it must not trip the over-request
    // guard. `amountIn` (token units) is what is checked there.
    const wallet = ethWallet(new Map([[USDC, '10000000']]))
    const quote = await makePlugin(
      okAction({
        tx: {
          to: ROUTER,
          data: '0x9be111d1deadbeef',
          value: '30000000000000',
          chainId: 1
        },
        amountIn: makeAmount('3000000', `0x${USDC}`, false, 6, 'USDC')
      })
    ).fetchSwapQuote(
      usdcRequest({
        fromWallet: wallet,
        fromTokenId: USDC,
        toTokenId: USDT,
        nativeAmount: '3000000'
      }),
      undefined,
      { infoPayload: {} }
    )
    assert.equal(quote.fromNativeAmount, '3000000')
  })

  it('leaves an unrecognized error code as a plain Error, not a mis-typed swap error', async function () {
    // An unknown failure must NOT be dressed up as a currency/limit error; the
    // core would otherwise mis-rank it against real providers.
    const plugin = makePlugin(errorBody('INTERNAL_SERVER_ERROR', 'boom'))
    await plugin
      .fetchSwapQuote(usdcRequest(), undefined, { infoPayload: {} })
      .then(
        () => assert.fail('expected a plain Error'),
        (error: unknown) => {
          assert.equal((error as Error).name, 'Error')
          assert.include((error as Error).message, 'INTERNAL_SERVER_ERROR')
        }
      )
  })
})

describe('swapsxyz fetchSwapQuote success-response guards', function () {
  it('rejects a non-EVM route (vmId) with SwapCurrencyError', async function () {
    // swaps.xyz can route solana/tron/etc, but this plugin only executes EVM
    // calldata, so a non-evm vmId is unsupported here.
    await expectErrorName(
      makePlugin(okAction({ vmId: 'solana' })),
      usdcRequest(),
      'SwapCurrencyError'
    )
  })

  it('rejects a gasless execution type with SwapCurrencyError', async function () {
    await expectErrorName(
      makePlugin(okAction({ executionsType: 'GASLESS' })),
      usdcRequest(),
      'SwapCurrencyError'
    )
  })

  it('maps a zero-output route to SwapBelowLimitError', async function () {
    // A zero amountOut means the input is below the route's usable minimum.
    await expectErrorName(
      makePlugin(
        okAction({
          amountOut: makeAmount('0', `0x${USDC}`, false, 6, 'USDC')
        })
      ),
      usdcRequest(),
      'SwapBelowLimitError'
    )
  })
})

describe('swapsxyz fetchSwapQuote success', function () {
  it('builds a quote for a native EVM source', async function () {
    const quote = await makePlugin(okAction()).fetchSwapQuote(
      usdcRequest(),
      undefined,
      { infoPayload: {} }
    )
    assert.equal(quote.pluginId, 'swapsxyz')
    assert.equal(quote.fromNativeAmount, '10000000000000000')
    // minReceiveAmount comes straight from the route's amountOutMin.
    assert.equal(quote.minReceiveAmount, '18964852')
    assert.equal(quote.toNativeAmount, '19156417')
    assert.equal(quote.isEstimate, true)
  })
})
