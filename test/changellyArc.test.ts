import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapRequest
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeChangellyPlugin } from '../src/swap/central/changelly'

const ARC_ADDRESS = '0x8feec0972935bb18402d0031d448135f7e0a2813'
const LTC_ADDRESS = 'LZ4hqRRHuCEUZaKfDrpvJ4NCFVBTFVQzcU'
const DEPOSIT_ADDRESS = '0x1111111111111111111111111111111111111111'

const makeWallet = (
  pluginId: string,
  currencyCode: string,
  multiplier: string,
  address: string
): EdgeCurrencyWallet => {
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier }]
  }
  return ({
    id: `${pluginId}-wallet`,
    balanceMap: new Map(),
    currencyInfo,
    currencyConfig: { currencyInfo, allTokens: {} },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    },
    async makeSpend(spendInfo: EdgeSpendInfo) {
      return {
        networkFee: '0',
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      }
    }
  } as unknown) as EdgeCurrencyWallet
}

const arcWallet = makeWallet('arc', 'USDC', '1' + '0'.repeat(18), ARC_ADDRESS)
const ltcWallet = makeWallet('litecoin', 'LTC', '100000000', LTC_ADDRESS)

/** Changelly's rows for the assets these cases quote, as of 2026-10-02. */
const CURRENCIES = [
  { ticker: 'usdcarc', blockchain: 'arc', contractAddress: '' },
  { ticker: 'ltc', blockchain: 'litecoin', contractAddress: '' },
  {
    ticker: 'usdc',
    blockchain: 'ethereum',
    contractAddress: '0xa0b86991c6218b36c1d19d4a5e9eb0ce3606eb48'
  }
].map(row => ({ ...row, enabled: true, fixRateEnabled: true }))

describe('changelly fetchSwapQuote on Arc', function () {
  it("sends Arc's native USDC as `usdcarc`, in whole USDC", async function () {
    const bodies: Array<{ method: string; params: any }> = []
    const plugin = makeChangellyPlugin(({
      io: {
        fetch: async (_uri: string, opts: { body: string }) => {
          const body = JSON.parse(opts.body)
          bodies.push(body)
          const result =
            body.method === 'getCurrenciesFull'
              ? CURRENCIES
              : body.method === 'getFixRateForAmount'
              ? [{ id: 'rate-1' }]
              : {
                  id: 'order-1',
                  trackUrl: 'https://changelly.com/track/order-1',
                  amountExpectedFrom: '60',
                  amountExpectedTo: '0.5',
                  payinAddress: DEPOSIT_ADDRESS,
                  payTill: new Date(Date.now() + 60000).toISOString()
                }
          return { ok: true, status: 200, json: async () => ({ result }) }
        }
      },
      initOptions: { apiKey: 'test-key', partnerId: 'test-partner' },
      log: { warn() {} }
    } as unknown) as EdgeCorePluginOptions)

    const request: EdgeSwapRequest = {
      fromWallet: arcWallet,
      toWallet: ltcWallet,
      fromTokenId: null,
      toTokenId: null,
      nativeAmount: '60' + '0'.repeat(18),
      quoteFor: 'from'
    }
    const quote = await plugin.fetchSwapQuote(request, undefined, {
      infoPayload: {}
    })

    const rate = bodies.find(body => body.method === 'getFixRateForAmount')
    assert.deepInclude(rate?.params, {
      from: 'usdcarc',
      to: 'ltc',
      amountFrom: '60'
    })
    assert.equal(quote.fromNativeAmount, '60' + '0'.repeat(18))
    assert.equal(quote.toNativeAmount, '50000000')
  })
})
