import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSwapPlugin,
  EdgeSwapRequest
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeXgramPlugin } from '../src/swap/central/xgram'

/**
 * Xgram reports a rejected API key as an HTTP 200 carrying
 * `{"status":401,"message":"Unauthorized"}`, measured against the live API on
 * 2026-09-03 when our partner key stopped being accepted.
 */
const UNAUTHORIZED_BODY = { status: 401, message: 'Unauthorized' }

const BTC_ADDRESS = 'bc1q6aas41krwvvcc4hhio6u4euf1y3wkbtap8uhmrt'
const SOL_ADDRESS = 'fnW7xCjkTG9XY7pG9NhBhoAN3NsLVJR5y3nfax1yQwg'
const BTC_MULTIPLIER = '100000000'
const SOL_MULTIPLIER = '1000000000'

const makeFakeWallet = (
  pluginId: string,
  currencyCode: string,
  address: string,
  multiplier: string
): EdgeCurrencyWallet => {
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  }

  return ({
    id: `${pluginId}-wallet`,
    currencyInfo,
    currencyConfig: {
      // `SwapCurrencyError` reads the pluginId through here.
      currencyInfo,
      allTokens: {}
    },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    }
  } as unknown) as EdgeCurrencyWallet
}

const makePlugin = (body: unknown, requestLog: string[]): EdgeSwapPlugin => {
  const fetch = async (uri: string): Promise<unknown> => {
    requestLog.push(uri)
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body)
    }
  }

  return makeXgramPlugin(({
    io: { fetch, fetchCors: fetch },
    initOptions: { apiKey: 'test-key' },
    log: Object.assign(() => {}, { warn() {} })
  } as unknown) as EdgeCorePluginOptions)
}

const makeRequest = (): EdgeSwapRequest => ({
  fromWallet: makeFakeWallet('bitcoin', 'BTC', BTC_ADDRESS, BTC_MULTIPLIER),
  fromTokenId: null,
  toWallet: makeFakeWallet('solana', 'SOL', SOL_ADDRESS, SOL_MULTIPLIER),
  toTokenId: null,
  nativeAmount: '1000000',
  quoteFor: 'from'
})

describe('xgram transport errors', function () {
  it('names the status and message Xgram sent back', async function () {
    // Regression shape: the `{status, message}` body matched none of the quote
    // cleaners, so the union threw `Expected a string, got undefined at .error`
    // and the real cause never reached the logs.
    const requestLog: string[] = []
    const plugin = makePlugin(UNAUTHORIZED_BODY, requestLog)

    let thrown: unknown
    try {
      await plugin.fetchSwapQuote(makeRequest(), undefined, { infoPayload: {} })
    } catch (error: unknown) {
      thrown = error
    }

    assert.isTrue(thrown instanceof Error)
    assert.equal((thrown as Error).name, 'XgramStatusError')
    assert.equal((thrown as Error).message, 'Xgram: HTTP 401 Unauthorized')
  })

  it('does not retry a transport refusal as a float order', async function () {
    // The float fallback exists for fixed-rate-only failures. A refusal that
    // precedes rate handling fails the same way twice, so retrying it only
    // doubles the load Xgram has asked us to reduce.
    const requestLog: string[] = []
    const plugin = makePlugin(UNAUTHORIZED_BODY, requestLog)

    await plugin
      .fetchSwapQuote(makeRequest(), undefined, { infoPayload: {} })
      .catch(() => undefined)

    assert.equal(requestLog.length, 1)
    assert.include(requestLog[0], 'type=fixed')
  })

  it('still falls back to float on a rate-type failure', async function () {
    const requestLog: string[] = []
    const plugin = makePlugin(
      { result: false, error: 'Error while creating exchange' },
      requestLog
    )

    await plugin
      .fetchSwapQuote(makeRequest(), undefined, { infoPayload: {} })
      .catch(() => undefined)

    assert.equal(requestLog.length, 2)
    assert.include(requestLog[1], 'type=float')
  })
})
