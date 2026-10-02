import { assert } from 'chai'
import {
  EdgeSpendInfo,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTokenId
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeLifiPlugin } from '../src/swap/defi/lifi'
// Captured on 2026-10-02 from https://li.quest/v1/quote, trimmed to the
// fields the plugin reads plus the route's identity:
import lifiSolanaQuotes from './lifiSolanaQuotes.json'

const SOLANA_ADDRESS = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'
const EVM_ADDRESS = '0x0b0901e9cef9eaed5753519177e3c7cfd0ef96ef'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const ARBITRUM_USDC_TOKEN_ID = 'af88d065e77c8cc2239327c5edb3a432268e5831'
const NETWORK_FEE = '5000'

const makeToken = (currencyCode: string, contractAddress: string): object => ({
  currencyCode,
  denominations: [{ name: currencyCode, multiplier: '1000000' }],
  displayName: currencyCode,
  networkLocation: { contractAddress }
})

const makeWallet = (
  pluginId: string,
  currencyCode: string,
  publicAddress: string,
  allTokens: { [tokenId: string]: object },
  spends: EdgeSpendInfo[]
): any => {
  const decimals = pluginId === 'solana' ? 9 : 18
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [
      { name: currencyCode, multiplier: '1' + '0'.repeat(decimals) }
    ]
  }
  return {
    id: `${pluginId}Wallet`,
    balanceMap: new Map(),
    currencyConfig: { allTokens, currencyInfo },
    currencyInfo,
    getAddresses: async () => [{ publicAddress }],
    makeSpend: async (spendInfo: EdgeSpendInfo) => {
      // The Solana engine decodes the spend target the same way,
      // and rejects a spend to the wallet's own address:
      for (const target of spendInfo.spendTargets) {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(target.publicAddress ?? '')) {
          throw new Error('Non-base58 character')
        }
        if (target.publicAddress === publicAddress) {
          throw new Error('Spending to self')
        }
      }
      spends.push(spendInfo)
      return { networkFee: NETWORK_FEE, savedAction: spendInfo.savedAction }
    }
  }
}

describe('lifi fetchSwapQuote from Solana', function () {
  interface Harness {
    spends: EdgeSpendInfo[]
    fetchQuote: (
      nativeAmount: string,
      fromTokenId: EdgeTokenId,
      toPluginId: string,
      toTokenId: EdgeTokenId
    ) => Promise<EdgeSwapQuote>
  }

  const makeHarness = (quoteJson: unknown): Harness => {
    const spends: EdgeSpendInfo[] = []

    const fetch = async (url: string): Promise<unknown> => {
      if (url.includes('v1/quote')) {
        return { ok: true, json: async () => quoteJson }
      }
      // The info server is optional, and the plugin falls back to defaults:
      return { ok: false, text: async () => 'not found' }
    }

    const plugin = makeLifiPlugin({
      initOptions: {},
      io: { fetch, fetchCors: fetch },
      log: { warn: () => {} }
    } as any)

    const fromWallet = makeWallet(
      'solana',
      'SOL',
      SOLANA_ADDRESS,
      { [SOLANA_USDC]: makeToken('USDC', SOLANA_USDC) },
      spends
    )

    const fetchQuote = async (
      nativeAmount: string,
      fromTokenId: EdgeTokenId,
      toPluginId: string,
      toTokenId: EdgeTokenId
    ): Promise<EdgeSwapQuote> => {
      const request: EdgeSwapRequest = {
        fromWallet,
        toWallet: makeWallet(
          toPluginId,
          toPluginId === 'polygon' ? 'POL' : 'ETH',
          EVM_ADDRESS,
          { [ARBITRUM_USDC_TOKEN_ID]: makeToken('USDC', ARBITRUM_USDC) },
          []
        ),
        fromTokenId,
        toTokenId,
        nativeAmount,
        quoteFor: 'from'
      }
      return await plugin.fetchSwapQuote(request, undefined, {
        infoPayload: {},
        promoCode: undefined
      })
    }

    return { spends, fetchQuote }
  }

  it('captured quotes carry no Solana address in the fee step', function () {
    for (const quote of Object.values(lifiSolanaQuotes)) {
      assert.match(quote.includedSteps[0].estimate.approvalAddress, /^0x0+$/)
      assert.match(quote.estimate.approvalAddress, /^0x/)
    }
  })

  it('quotes SOL through a route with only EVM approval addresses', async function () {
    const { solToPolMayan } = lifiSolanaQuotes
    const { spends, fetchQuote } = makeHarness(solToPolMayan)
    const quote = await fetchQuote('50000000', null, 'polygon', null)

    assert.equal(quote.fromNativeAmount, '50000000')
    assert.equal(quote.toNativeAmount, solToPolMayan.estimate.toAmount)
    assert.equal(spends.length, 1)
    assert.deepEqual(spends[0].spendTargets, [
      { nativeAmount: '50000000', publicAddress: SYSTEM_PROGRAM }
    ])
    assert.deepEqual(spends[0].otherParams, {
      unsignedTx: solToPolMayan.transactionRequest.data
    })
  })

  it('quotes SOL through a route with a Solana approval address', async function () {
    const { solToArbUsdcRelay } = lifiSolanaQuotes
    const { spends, fetchQuote } = makeHarness(solToArbUsdcRelay)
    const quote = await fetchQuote(
      '50000000',
      null,
      'arbitrum',
      ARBITRUM_USDC_TOKEN_ID
    )

    assert.equal(quote.toNativeAmount, solToArbUsdcRelay.estimate.toAmount)
    assert.equal(spends.length, 1)
    assert.equal(spends[0].spendTargets[0].publicAddress, SYSTEM_PROGRAM)
    assert.deepEqual(spends[0].otherParams, {
      unsignedTx: solToArbUsdcRelay.transactionRequest.data
    })
  })

  it('quotes a Solana token with the mint as the spend target', async function () {
    const { solUsdcToArbUsdcLayerswap } = lifiSolanaQuotes
    const { spends, fetchQuote } = makeHarness(solUsdcToArbUsdcLayerswap)
    const quote = await fetchQuote(
      '5000000',
      SOLANA_USDC,
      'arbitrum',
      ARBITRUM_USDC_TOKEN_ID
    )

    assert.equal(quote.fromNativeAmount, '5000000')
    assert.equal(spends.length, 1)
    assert.equal(spends[0].tokenId, SOLANA_USDC)
    assert.deepEqual(spends[0].spendTargets, [
      { nativeAmount: '5000000', publicAddress: SOLANA_USDC }
    ])
    if (spends[0].savedAction?.actionType !== 'swap') {
      throw new Error('Expected a swap action')
    }
    assert.equal(spends[0].savedAction.fromAsset.nativeAmount, '5000000')
  })
})
