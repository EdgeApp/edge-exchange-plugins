import { sub } from 'biggystring'
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

import { makeNymPlugin } from '../src/swap/central/nym'

// Checksummed EVM address. Edge's Ethereum engine stores this exact string as
// `walletLocalData.publicKey` AND hands it back from `getFreshAddress`, so the
// swap plugin's refund address and the engine's own public key are identical.
const ETH_ADDRESS = '0x9A5c4A9F9E6f3fC7f8E1B8B0C9d5e6A7B8C9d0E1'
const NYM_ADDRESS = 'n1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu'
const USDT_TOKEN_ID = 'dac17f958d2ee523a2206206994597c13d831ec7'
const USDT_BALANCE = '14009000'
// NYM's own ERC-20, which NYM lists on `chainNetwork: 'ethereum'`.
const NYM_TOKEN_ID = '525a8f6f3ba4752868cde25164382bfbae3990e1'
const ETH_BALANCE = '1000000000000000000'
// What the Ethereum engine's native branch holds back for the network fee.
const ETH_FEE = '196600000000000'
const ETH_MAX_SPENDABLE = '999803400000000000'

/**
 * Mirrors the `SpendToSelfError` guard in edge-currency-accountbased's
 * `makeSpendCheck`, which every engine call runs before pricing a spend.
 */
class SpendToSelfError extends Error {
  name = 'SpendToSelfError'
  constructor() {
    super('Spend to self')
  }
}

interface FakeWalletOpts {
  pluginId: string
  currencyCode: string
  address: string
  evmChainId?: number
  balanceMap?: Map<string | null, string>
  /** Records every spend the plugin asks the engine to price. */
  spendLog?: EdgeSpendInfo[]
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const {
    address,
    balanceMap = new Map(),
    currencyCode,
    evmChainId,
    pluginId,
    spendLog = []
  } = opts

  const checkSpend = (spendInfo: EdgeSpendInfo): void => {
    spendLog.push(spendInfo)
    const { skipChecks = false } = spendInfo
    for (const spendTarget of spendInfo.spendTargets) {
      if (!skipChecks && spendTarget.publicAddress === address) {
        throw new SpendToSelfError()
      }
    }
  }

  const currencyInfo = {
    pluginId,
    currencyCode,
    evmChainId,
    denominations: [{ name: currencyCode, multiplier: '1000000000000000000' }]
  }

  return ({
    id: `${pluginId}-wallet`,
    balanceMap,
    currencyInfo,
    currencyConfig: {
      // `SwapCurrencyError` reads the pluginId through here.
      currencyInfo,
      allTokens: {
        [USDT_TOKEN_ID]: {
          currencyCode: 'USDT',
          denominations: [{ name: 'USDT', multiplier: '1000000' }],
          networkLocation: { contractAddress: `0x${USDT_TOKEN_ID}` }
        },
        [NYM_TOKEN_ID]: {
          currencyCode: 'NYM',
          denominations: [{ name: 'NYM', multiplier: '1000000' }],
          networkLocation: { contractAddress: `0x${NYM_TOKEN_ID}` }
        }
      }
    },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo) {
      checkSpend(spendInfo)
      const balance = balanceMap.get(spendInfo.tokenId) ?? '0'
      // Matches the Ethereum engine: the token branch spends the whole token
      // balance (the fee comes out of the parent currency), while the native
      // branch holds back the network fee.
      return spendInfo.tokenId == null ? sub(balance, ETH_FEE) : balance
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      checkSpend(spendInfo)
      return ({
        networkFee: '0',
        parentNetworkFee: '196600000000000',
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      } as unknown) as EdgeTransaction
    }
  } as unknown) as EdgeCurrencyWallet
}

/** A 400 error body the fake `fetchCors` returns for the /quote endpoint. */
type QuoteError = Record<string, unknown> | null

/**
 * Canned quote + order responses from NYM's partner API. The quote echoes the
 * requested `sourceAmount` back, as the live API does, so a max swap's second
 * (post-`getMaxSpendable`) quote reports the trimmed amount. Pass `quoteError`
 * to make the /quote endpoint fail with that 400 body, mirroring NYM rejecting
 * an out-of-limit amount before it will quote.
 */
const makeFakeIo = (quoteError: QuoteError = null): { fetchCors: Function } => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  return {
    fetchCors: async (uri: string, opts: { body: string }) => {
      const sent = JSON.parse(opts.body)
      if (uri.endsWith('/quote') && quoteError != null) {
        return {
          ok: false,
          status: 400,
          json: async () => quoteError,
          text: async () => JSON.stringify(quoteError)
        }
      }
      const body = uri.endsWith('/quote')
        ? {
            quoteId: 'quote-1',
            sourceAmount: sent.sourceAmount,
            destinationAmount: '762710000',
            rate: '54.4',
            expiresAt,
            // Wide enough to hold both a token balance and a whole-ETH
            // balance, so neither max case trips the limit checks.
            minSourceAmount: '1000000',
            maxSourceAmount: '10000000000000000000',
            minDestinationAmount: '1000000',
            maxDestinationAmount: '100000000000'
          }
        : {
            orderId: 'order-1',
            status: 'waiting',
            payinAddress: '0x1111111111111111111111111111111111111111',
            expiresAt
          }
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body)
      }
    }
  }
}

const makePlugin = (quoteError: QuoteError = null): EdgeSwapPlugin =>
  makeNymPlugin(({
    io: makeFakeIo(quoteError),
    initOptions: { apiKey: 'test-key' },
    log: { warn() {} }
  } as unknown) as EdgeCorePluginOptions)

const makeNymWallet = (): EdgeCurrencyWallet =>
  makeFakeWallet({
    pluginId: 'nym',
    currencyCode: 'NYM',
    address: NYM_ADDRESS
  })

describe('nym', function () {
  it('quotes a max swap from an EVM token without spending to self', async function () {
    const spendLog: EdgeSpendInfo[] = []
    const fromWallet = makeFakeWallet({
      pluginId: 'ethereum',
      currencyCode: 'ETH',
      address: ETH_ADDRESS,
      evmChainId: 1,
      balanceMap: new Map([[USDT_TOKEN_ID, USDT_BALANCE]]),
      spendLog
    })

    const request: EdgeSwapRequest = {
      fromWallet,
      fromTokenId: USDT_TOKEN_ID,
      toWallet: makeNymWallet(),
      toTokenId: null,
      nativeAmount: '0',
      quoteFor: 'max'
    }

    const quote = await makePlugin().fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    assert.equal(quote.fromNativeAmount, USDT_BALANCE)
    // The fee-estimation probe targets the user's own address, so it must opt
    // out of the engine's spend checks; the real order must not.
    const [probeSpend, orderSpend] = spendLog
    assert.equal(probeSpend.skipChecks, true)
    assert.equal(probeSpend.spendTargets[0].publicAddress, ETH_ADDRESS)
    assert.notEqual(orderSpend.skipChecks, true)
    assert.notEqual(orderSpend.spendTargets[0].publicAddress, ETH_ADDRESS)
  })

  it('quotes a max swap from a native EVM asset without spending to self', async function () {
    // The engine's self-spend guard compares the spend target against its own
    // public key, which on EVM chains is the address itself, so the probe trips
    // it for a native balance exactly as it does for a token. The Ethereum
    // engine runs that check in BOTH `getMaxSpendable` branches.
    const spendLog: EdgeSpendInfo[] = []
    const fromWallet = makeFakeWallet({
      pluginId: 'ethereum',
      currencyCode: 'ETH',
      address: ETH_ADDRESS,
      evmChainId: 1,
      balanceMap: new Map([[null, ETH_BALANCE]]),
      spendLog
    })

    const request: EdgeSwapRequest = {
      fromWallet,
      fromTokenId: null,
      toWallet: makeNymWallet(),
      toTokenId: null,
      nativeAmount: '0',
      quoteFor: 'max'
    }

    const quote = await makePlugin().fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    // The max quote is the whole balance less the held-back network fee.
    assert.equal(quote.fromNativeAmount, ETH_MAX_SPENDABLE)
    const [probeSpend, orderSpend] = spendLog
    assert.equal(probeSpend.tokenId, null)
    assert.equal(probeSpend.skipChecks, true)
    assert.equal(probeSpend.spendTargets[0].publicAddress, ETH_ADDRESS)
    assert.notEqual(orderSpend.skipChecks, true)
    assert.notEqual(orderSpend.spendTargets[0].publicAddress, ETH_ADDRESS)
  })

  it('rejects an EVM-to-EVM pair, which NYM does not route', async function () {
    // NYM provides its own liquidity, so its API requires native NYM (the Nyx
    // chain) on one side: `ETH -> NYM (ERC-20)` comes back as
    // "Unsupported swap pair: one side must be NYM" even though both assets are
    // listed. The plugin gates the same rule locally, which also covers the
    // same-wallet case, where the from and to wallets are one EVM wallet.
    const wallet = makeFakeWallet({
      pluginId: 'ethereum',
      currencyCode: 'ETH',
      address: ETH_ADDRESS,
      evmChainId: 1,
      balanceMap: new Map([[null, ETH_BALANCE]])
    })

    const request: EdgeSwapRequest = {
      fromWallet: wallet,
      fromTokenId: null,
      toWallet: wallet,
      toTokenId: NYM_TOKEN_ID,
      nativeAmount: '0',
      quoteFor: 'max'
    }

    await makePlugin()
      .fetchSwapQuote(request, undefined, { infoPayload: {} })
      .then(
        () => assert.fail('expected SwapCurrencyError'),
        (error: unknown) =>
          assert.equal((error as Error).name, 'SwapCurrencyError')
      )
  })

  it('maps a below-minimum max swap to SwapBelowLimitError, not SwapCurrencyError', async function () {
    // A native-EVM wallet whose ENTIRE balance is below NYM's minimum: the
    // whole-balance max probe gets NYM's 400 `UnderLimitError`. Mapped to the
    // ranked `SwapBelowLimitError` it wins error ranking and tells the user the
    // real reason; left as `SwapCurrencyError` it loses to an unrelated plugin
    // and surfaces the misleading "No enabled exchanges support ETH to NYM".
    const fromWallet = makeFakeWallet({
      pluginId: 'ethereum',
      currencyCode: 'ETH',
      address: ETH_ADDRESS,
      evmChainId: 1,
      balanceMap: new Map([[null, '3500000000000000']])
    })

    const request: EdgeSwapRequest = {
      fromWallet,
      fromTokenId: null,
      toWallet: makeNymWallet(),
      toTokenId: null,
      nativeAmount: '0',
      quoteFor: 'max'
    }

    const quoteError = {
      errors: [
        {
          error: 'UnderLimitError',
          sourceAmountLimit: '5000000000000000',
          destinationAmountLimit: '511491944'
        }
      ]
    }

    await makePlugin(quoteError)
      .fetchSwapQuote(request, undefined, { infoPayload: {} })
      .then(
        () => assert.fail('expected SwapBelowLimitError'),
        (error: unknown) => {
          assert.equal((error as Error).name, 'SwapBelowLimitError')
          // The source-side limit, in native units, comes straight from NYM.
          assert.equal(
            (error as { nativeMin?: string }).nativeMin,
            '5000000000000000'
          )
        }
      )
  })

  it('maps an above-maximum swap to SwapAboveLimitError', async function () {
    const fromWallet = makeFakeWallet({
      pluginId: 'ethereum',
      currencyCode: 'USDT',
      address: ETH_ADDRESS,
      evmChainId: 1,
      balanceMap: new Map([[USDT_TOKEN_ID, '999999000000']])
    })

    const request: EdgeSwapRequest = {
      fromWallet,
      fromTokenId: USDT_TOKEN_ID,
      toWallet: makeNymWallet(),
      toTokenId: null,
      nativeAmount: '999999000000',
      quoteFor: 'from'
    }

    const quoteError = {
      errors: [
        {
          error: 'OverLimitError',
          sourceAmountLimit: '50000000000',
          destinationAmountLimit: '2722222222222'
        }
      ]
    }

    await makePlugin(quoteError)
      .fetchSwapQuote(request, undefined, { infoPayload: {} })
      .then(
        () => assert.fail('expected SwapAboveLimitError'),
        (error: unknown) => {
          assert.equal((error as Error).name, 'SwapAboveLimitError')
          assert.equal(
            (error as { nativeMax?: string }).nativeMax,
            '50000000000'
          )
        }
      )
  })
})
