import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapRequest,
  EdgeTransaction
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeLifiPlugin } from '../src/swap/defi/lifi'
import lifiSolanaQuotes from './lifiSolanaQuotes.json'

const SOLANA_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const EVM_ADDRESS = '0x0b0901e9cef9eaed5753519177e3c7cfd0ef96ef'
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111'
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BASE_USDC = '833589fcd6edb6e08f4c7c32d4f71b54bda02913'

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

interface FakeWalletOpts {
  address: string
  currencyCode: string
  pluginId: string
  spendLog?: EdgeSpendInfo[]
  tokens?: { [tokenId: string]: string }
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const { address, currencyCode, pluginId, spendLog = [], tokens = {} } = opts
  const multiplier = pluginId === 'solana' ? '1000000000' : '1'.padEnd(19, '0')
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  }

  const allTokens: {
    [tokenId: string]: {
      currencyCode: string
      denominations: Array<{ name: string; multiplier: string }>
      networkLocation: { contractAddress: string }
    }
  } = {}
  for (const tokenId of Object.keys(tokens)) {
    allTokens[tokenId] = {
      currencyCode: 'USDC',
      denominations: [{ name: 'USDC', multiplier: '1000000' }],
      networkLocation: { contractAddress: tokens[tokenId] }
    }
  }

  return ({
    id: `${pluginId}-wallet`,
    balanceMap: new Map(),
    currencyInfo,
    currencyConfig: { currencyInfo, allTokens },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    },
    // Rejects what the Solana engine rejects: a spend target that is not a
    // base58 address, or one that is the wallet itself.
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      const { publicAddress = '' } = spendInfo.spendTargets[0]
      if (!BASE58_ADDRESS.test(publicAddress)) {
        throw new Error('Non-base58 character')
      }
      if (publicAddress === address) throw new Error('SpendToSelfError')
      spendLog.push(spendInfo)
      return ({
        networkFee: '5000',
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      } as unknown) as EdgeTransaction
    }
  } as unknown) as EdgeCurrencyWallet
}

/** Plugin options whose LI.FI quote endpoint answers with `quote`. */
const makeOpts = (quote: unknown): EdgeCorePluginOptions => {
  const fetch = async (uri: string): Promise<unknown> => {
    if (uri.includes('/v1/quote?')) {
      return { ok: true, status: 200, json: async () => quote }
    }
    // The info server: the plugin falls back to its defaults.
    return { ok: false, status: 404, text: async () => 'not found' }
  }
  const log = Object.assign(() => {}, { warn: () => {}, error: () => {} })
  return ({
    initOptions: {},
    io: { fetch },
    log
  } as unknown) as EdgeCorePluginOptions
}

describe('lifi swaps from a Solana source', function () {
  const { solToPol, usdcToBaseUsdc } = lifiSolanaQuotes

  it('quotes SOL with a spend the Solana engine accepts', async function () {
    const spendLog: EdgeSpendInfo[] = []
    const request: EdgeSwapRequest = {
      fromWallet: makeFakeWallet({
        address: SOLANA_ADDRESS,
        currencyCode: 'SOL',
        pluginId: 'solana',
        spendLog
      }),
      fromTokenId: null,
      toWallet: makeFakeWallet({
        address: EVM_ADDRESS,
        currencyCode: 'POL',
        pluginId: 'polygon'
      }),
      toTokenId: null,
      nativeAmount: solToPol.estimate.fromAmount,
      quoteFor: 'from'
    }

    const plugin = makeLifiPlugin(makeOpts(solToPol))
    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    assert.equal(spendLog.length, 1)
    const [spendInfo] = spendLog
    assert.equal(spendInfo.tokenId, null)
    assert.deepEqual(spendInfo.spendTargets, [
      {
        nativeAmount: solToPol.estimate.fromAmount,
        publicAddress: SOLANA_SYSTEM_PROGRAM
      }
    ])
    assert.deepEqual(spendInfo.otherParams, {
      unsignedTx: solToPol.transactionRequest.data
    })
    assert.equal(quote.toNativeAmount, solToPol.estimate.toAmount)
  })

  it('quotes a Solana token with a spend the Solana engine accepts', async function () {
    const spendLog: EdgeSpendInfo[] = []
    const request: EdgeSwapRequest = {
      fromWallet: makeFakeWallet({
        address: SOLANA_ADDRESS,
        currencyCode: 'SOL',
        pluginId: 'solana',
        spendLog,
        tokens: { [SOLANA_USDC]: SOLANA_USDC }
      }),
      fromTokenId: SOLANA_USDC,
      toWallet: makeFakeWallet({
        address: EVM_ADDRESS,
        currencyCode: 'ETH',
        pluginId: 'base',
        tokens: { [BASE_USDC]: `0x${BASE_USDC}` }
      }),
      toTokenId: BASE_USDC,
      nativeAmount: usdcToBaseUsdc.estimate.fromAmount,
      quoteFor: 'from'
    }

    const plugin = makeLifiPlugin(makeOpts(usdcToBaseUsdc))
    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    assert.equal(spendLog.length, 1)
    const [spendInfo] = spendLog
    assert.equal(spendInfo.tokenId, SOLANA_USDC)
    assert.deepEqual(spendInfo.spendTargets, [
      {
        nativeAmount: usdcToBaseUsdc.estimate.fromAmount,
        publicAddress: SOLANA_USDC
      }
    ])
    assert.deepEqual(spendInfo.otherParams, {
      unsignedTx: usdcToBaseUsdc.transactionRequest.data
    })
    assert.equal(quote.toNativeAmount, usdcToBaseUsdc.estimate.toAmount)
  })
})
