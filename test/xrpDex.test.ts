import { assert } from 'chai'
import {
  EdgeCurrencyWallet,
  EdgeSwapInfo,
  EdgeSwapRequest,
  EdgeTokenId,
  InsufficientFundsError
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { fetchSwapQuote } from '../src/swap/defi/xrpDex'
import { PluginEnvironment } from '../src/util/makeSwapPlugin'

const XRP_TOKEN_ID = 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq-USD'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'xrpdex',
  isDex: true,
  displayName: 'XRP DEX',
  supportEmail: 'support@edge.app'
}

const env = ({ swapInfo } as unknown) as PluginEnvironment

interface FakeWallet {
  wallet: EdgeCurrencyWallet
  /** How many times the plugin asked this wallet for its spendable balance. */
  maxSpendableCalls: () => number
}

/**
 * A wallet whose engine refuses to report a spendable balance, like a
 * piratechain wallet with nothing to spend or any non-XRP chain rejecting the
 * plugin's XRP dummy address.
 */
const makeFakeWallet = (
  pluginId: string,
  currencyCode: string,
  id: string = `${pluginId}-wallet`
): FakeWallet => {
  let calls = 0
  const currencyInfo = { pluginId, currencyCode }
  const wallet = ({
    id,
    balanceMap: new Map<EdgeTokenId, string>(),
    currencyInfo,
    currencyConfig: {
      currencyInfo,
      allTokens: { [XRP_TOKEN_ID]: { currencyCode: 'USD' } }
    },
    async getMaxSpendable() {
      calls++
      throw new InsufficientFundsError({ tokenId: null })
    }
  } as unknown) as EdgeCurrencyWallet
  return { wallet, maxSpendableCalls: () => calls }
}

const makeRequest = (
  fromWallet: EdgeCurrencyWallet,
  toWallet: EdgeCurrencyWallet,
  overrides: Partial<EdgeSwapRequest> = {}
): EdgeSwapRequest => ({
  fromWallet,
  toWallet,
  fromTokenId: null,
  toTokenId: null,
  nativeAmount: '1000000',
  quoteFor: 'from',
  ...overrides
})

const expectError = async (
  request: EdgeSwapRequest,
  expectedName: string,
  expectedMessage?: string
): Promise<void> => {
  await fetchSwapQuote(env, request, undefined, {}).then(
    () => assert.fail(`expected ${expectedName}`),
    (error: unknown) => {
      assert.equal((error as Error).name, expectedName)
      if (expectedMessage != null) {
        assert.equal((error as Error).message, expectedMessage)
      }
    }
  )
}

describe('xrpDex fetchSwapQuote eligibility', function () {
  it('rejects a non-XRP source without reading its balance', async function () {
    const from = makeFakeWallet('piratechain', 'ARRR')
    const to = makeFakeWallet('ethereum', 'ETH')

    await expectError(
      makeRequest(from.wallet, to.wallet),
      'SwapCurrencyError',
      'XRP DEX does not support piratechain:null to ethereum:null'
    )
    assert.equal(from.maxSpendableCalls(), 0)
  })

  it('rejects a non-XRP source on a max quote', async function () {
    const from = makeFakeWallet('piratechain', 'ARRR')
    const to = makeFakeWallet('ethereum', 'ETH')

    await expectError(
      makeRequest(from.wallet, to.wallet, {
        nativeAmount: '0',
        quoteFor: 'max'
      }),
      'SwapCurrencyError'
    )
    assert.equal(from.maxSpendableCalls(), 0)
  })

  it('rejects a non-XRP destination without reading the balance', async function () {
    const from = makeFakeWallet('ripple', 'XRP')
    const to = makeFakeWallet('ethereum', 'ETH')

    await expectError(makeRequest(from.wallet, to.wallet), 'SwapCurrencyError')
    assert.equal(from.maxSpendableCalls(), 0)
  })

  it('rejects a same-asset XRP swap without reading the balance', async function () {
    const { wallet, maxSpendableCalls } = makeFakeWallet('ripple', 'XRP')

    await expectError(makeRequest(wallet, wallet), 'SwapCurrencyError')
    assert.equal(maxSpendableCalls(), 0)
  })

  it('rejects two XRP wallets without reading the balance', async function () {
    const from = makeFakeWallet('ripple', 'XRP', 'wallet-a')
    const to = makeFakeWallet('ripple', 'XRP', 'wallet-b')

    await expectError(
      makeRequest(from.wallet, to.wallet, { toTokenId: XRP_TOKEN_ID }),
      'Error',
      'XRP DEX must use same wallet for source and destination'
    )
    assert.equal(from.maxSpendableCalls(), 0)
  })

  it('still reports insufficient funds on a supported XRP pair', async function () {
    const { wallet, maxSpendableCalls } = makeFakeWallet('ripple', 'XRP')

    await expectError(
      makeRequest(wallet, wallet, { toTokenId: XRP_TOKEN_ID }),
      'InsufficientFundsError'
    )
    assert.equal(maxSpendableCalls(), 1)
  })
})
