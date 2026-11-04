import { gte } from 'biggystring'
import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeFetchFunction,
  EdgeFetchResponse,
  EdgeLog,
  EdgeSwapRequest
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  decodeTronApproval,
  hexToTronAddress,
  makeRangoAuthParams,
  makeRangoPlugin
} from '../src/swap/defi/rango'
import { makeQueryParams } from '../src/util/utils'

describe(`rango makeRangoAuthParams`, function () {
  it('sends the key as the apikey query parameter', function () {
    const query = makeQueryParams({
      ...makeRangoAuthParams('key-123'),
      amount: '1000'
    })
    const params = new URLSearchParams(query)
    assert.equal(params.get('apikey'), 'key-123')
    assert.equal(params.get('apiKey'), 'key-123')
  })
})

describe(`rango hexToTronAddress`, function () {
  it('converts the USDT TRC20 contract', function () {
    assert.equal(
      hexToTronAddress('41a614f803b6fd780986a42c78ec9c7f77e6ded13c'),
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    )
  })

  it('converts the Sun Swap router', function () {
    assert.equal(
      hexToTronAddress('414ab38f7ae7eadad03981b2a7d7883760aa63e564'),
      'TGnC7LMji8hBpyvZt1TTEJhVpAZ5HFyJ3r'
    )
  })

  it('converts an owner address', function () {
    assert.equal(
      hexToTronAddress('416c4d3cb629599f55e634bcbe08c9ffc560373d77'),
      'TKqrWJqFx9UwWS44UGxivLjeCUfuuPBT7Q'
    )
  })
})

describe(`rango decodeTronApproval`, function () {
  // A real Rango TRON approval: approve(TGnC7LMji8hBpyvZt1TTEJhVpAZ5HFyJ3r, 1000000)
  const approveData =
    '095ea7b30000000000000000000000004ab38f7ae7eadad03981b2a7d7883760aa63e56400000000000000000000000000000000000000000000000000000000000f4240'

  it('recovers the spender and allowance the approval grants', function () {
    assert.deepEqual(decodeTronApproval(approveData), {
      spender: 'TGnC7LMji8hBpyvZt1TTEJhVpAZ5HFyJ3r',
      nativeAmount: '1000000'
    })
  })

  it('tolerates a 0x prefix', function () {
    assert.equal(
      decodeTronApproval(`0x${approveData}`).spender,
      'TGnC7LMji8hBpyvZt1TTEJhVpAZ5HFyJ3r'
    )
  })

  it('decodes an unlimited allowance', function () {
    const unlimited = `${approveData.slice(0, 72)}${'f'.repeat(64)}`
    assert.equal(
      decodeTronApproval(unlimited).nativeAmount,
      // 2^256 - 1
      '115792089237316195423570985008687907853269984665640564039457584007913129639935'
    )
  })

  it('rejects call data that is not an approval', function () {
    // A swap call, not approve()
    assert.throws(() => decodeTronApproval(`cef95229${'0'.repeat(128)}`))
  })

  it('rejects a truncated approval', function () {
    assert.throws(() => decodeTronApproval('095ea7b300'))
  })

  it('rejects an approval missing its amount', function () {
    assert.throws(() => decodeTronApproval(approveData.slice(0, 72)))
  })
})

describe(`rango failed quotes`, function () {
  const makeFakeWallet = (
    pluginId: string,
    currencyCode: string,
    multiplier: string,
    publicAddress: string
  ): EdgeCurrencyWallet => {
    const currencyInfo = {
      pluginId,
      currencyCode,
      denominations: [{ name: currencyCode, multiplier }],
      walletType: `wallet:${pluginId}`
    }
    // Only the fields fetchSwapQuote reads before its first failure:
    return ({
      id: pluginId,
      type: `wallet:${pluginId}`,
      currencyInfo,
      currencyConfig: { allTokens: {}, currencyInfo },
      balanceMap: new Map([[null, '0']]),
      getAddresses: async () => [
        { addressType: 'publicAddress', publicAddress }
      ],
      otherMethods: {},
      stakingStatus: { stakePlans: [] }
    } as unknown) as EdgeCurrencyWallet
  }

  const makeFakeResponse = (status: number, body: unknown): EdgeFetchResponse =>
    (({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body
    } as unknown) as EdgeFetchResponse)

  const noRoute = {
    resultType: 'NO_ROUTE',
    route: null,
    error: 'No route available',
    tx: null
  }
  const routeOk = { resultType: 'OK', route: null, error: null, tx: null }

  // CACAO at $0.10 seeds the minimum search at $300, or 3000 CACAO:
  const CACAO = '10000000000'
  const SEED_NATIVE_AMOUNT = '30000000000000'
  const REQUEST_NATIVE_AMOUNT = '431560000000000'

  const log = (Object.assign(() => undefined, {
    warn: () => undefined,
    error: () => undefined
  }) as unknown) as EdgeLog

  /** Runs a real quote against fake Rango, info, and rates servers. */
  const quoteError = async (
    reply: (amount: string) => unknown,
    opts: { hasRate?: boolean; nativeAmount?: string } = {}
  ): Promise<Error & { nativeMin?: string }> => {
    const { hasRate = true, nativeAmount = REQUEST_NATIVE_AMOUNT } = opts
    const fetch: EdgeFetchFunction = async uri => {
      if (uri.includes('basic/swap')) {
        const amount = new URL(uri).searchParams.get('amount') ?? ''
        return makeFakeResponse(200, reply(amount))
      }
      if (uri.includes('v3/rates') && hasRate) {
        return makeFakeResponse(200, {
          targetFiat: 'USD',
          crypto: [
            { asset: { pluginId: 'mayachain', tokenId: null }, rate: 0.1 }
          ],
          fiat: []
        })
      }
      return makeFakeResponse(404, {})
    }

    const plugin = makeRangoPlugin(({
      io: { fetch, fetchCors: fetch },
      log,
      initOptions: { rangoApiKey: 'key' }
    } as unknown) as EdgeCorePluginOptions)

    const request: EdgeSwapRequest = {
      fromWallet: makeFakeWallet(
        'mayachain',
        'CACAO',
        CACAO,
        'maya1g8spuyp5ykfedfj5ljuwzmlwarcz2sxg0qhwgu'
      ),
      toWallet: makeFakeWallet(
        'bitcoin',
        'BTC',
        '100000000',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      ),
      fromTokenId: null,
      toTokenId: null,
      nativeAmount,
      quoteFor: 'from'
    }
    return await plugin
      .fetchSwapQuote(request, undefined, { infoPayload: {} })
      .then(
        () => {
          throw new Error('Expected the quote to fail')
        },
        (error: Error) => error
      )
  }

  it('reports no support when no amount has a route', async function () {
    const error = await quoteError(() => noRoute)
    assert.equal(error.name, 'SwapCurrencyError')
  })

  it('reports the minimum when a higher amount has a route', async function () {
    const min = '10000000000000'
    const error = await quoteError(
      amount => (gte(amount, min) ? routeOk : noRoute),
      { nativeAmount: '1000000000000' }
    )
    assert.equal(error.name, 'SwapBelowLimitError')
    assert.isTrue(gte(error.nativeMin ?? '0', min))
  })

  it('stays generic when a smaller amount has a route', async function () {
    const error = await quoteError(amount =>
      gte(SEED_NATIVE_AMOUNT, amount) ? routeOk : noRoute
    )
    assert.notEqual(error.name, 'SwapBelowLimitError')
    assert.match(error.message, /Rango could not proceed/)
  })

  it('keeps below-limit when Rango blames the amount', async function () {
    const inputLimit = await quoteError(() => ({
      ...noRoute,
      resultType: 'INPUT_LIMIT_ISSUE'
    }))
    assert.equal(inputLimit.name, 'SwapBelowLimitError')

    const tooLow = await quoteError(() => ({
      ...noRoute,
      error: 'Your input amount might be too low!'
    }))
    assert.equal(tooLow.name, 'SwapBelowLimitError')
  })

  it('stays generic when the search could not run', async function () {
    const error = await quoteError(() => noRoute, { hasRate: false })
    assert.match(error.message, /Rango could not proceed/)
  })
})
