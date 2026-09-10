import { base64urlnopad, utf8 } from '@scure/base'
import { assert } from 'chai'
import { EdgeCurrencyWallet, EdgeLog, EdgeSwapInfo } from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { SourceSpendContext } from '../src/swap/defi/thorchain/thorchainTypes'
import {
  appendMayaRefundAddress,
  makeZcashShieldedMemoSpend
} from '../src/swap/defi/thorchain/zcashShieldedMemo'
import { EdgeSwapRequestPlugin } from '../src/swap/types'

const REFUND = 't1MnUkHpi3Ampr9ZzAtnWHFbatsVF3hEvKL'
const VAULT = 't1RBiXrLRdrHgsuSGQEusG2wCzPFczEVMfT'
const MEMO_RECIPIENT =
  'u1fcwchlpy2u0t9hdl8wcku8dmvrhwz6lk0jwj2z56ylxhacpn9jnx5sgftx8kv7s97ay37'
const BTC_DESTINATION = 'bc1quser4cw7x46m2rxa78y32kv6nhzzssmvmpyfpcz'
const MEMO = `=:BTC.BTC:${BTC_DESTINATION}:0/1/1:ej:50`

const swapInfo: EdgeSwapInfo = {
  pluginId: 'mayaprotocol',
  isDex: true,
  displayName: 'Maya Protocol',
  supportEmail: 'support@edge.app'
}

const makeZecWallet = (transparentAddress?: string): EdgeCurrencyWallet => {
  const currencyInfo = {
    pluginId: 'zcash',
    currencyCode: 'ZEC',
    denominations: [{ name: 'ZEC', multiplier: '100000000' }]
  }
  const addresses = [
    { addressType: 'unifiedAddress', publicAddress: 'u1user' },
    { addressType: 'saplingAddress', publicAddress: 'zs1user' }
  ]
  if (transparentAddress != null) {
    addresses.push({
      addressType: 'transparentAddress',
      publicAddress: transparentAddress
    })
  }
  return ({
    currencyInfo,
    currencyConfig: { currencyInfo, allTokens: {} },
    async getAddresses() {
      return addresses
    }
  } as unknown) as EdgeCurrencyWallet
}

const inboundEntry = {
  chain: 'ZEC',
  address: VAULT,
  dust_threshold: '10000',
  halted: false,
  outbound_fee: '1',
  pub_key: 'pub',
  shielded_memo_config: {
    enabled: true,
    uivk: 'uivk1mayaviewingkey',
    unified_address: MEMO_RECIPIENT
  }
}

const log = (Object.assign(() => {}, {
  warn() {},
  error() {}
}) as unknown) as EdgeLog

const makeCtx = (
  overrides: Partial<SourceSpendContext> = {},
  fromWallet: EdgeCurrencyWallet = makeZecWallet(REFUND)
): SourceSpendContext => ({
  request: ({
    fromWallet,
    // Only the fields SwapCurrencyError reads:
    toWallet: { currencyConfig: { currencyInfo: { pluginId: 'bitcoin' } } },
    fromTokenId: null,
    toTokenId: null,
    fromCurrencyCode: 'ZEC',
    toCurrencyCode: 'BTC',
    nativeAmount: '123456789',
    quoteFor: 'from'
  } as unknown) as EdgeSwapRequestPlugin,
  swapInfo,
  fromMainnetCode: 'ZEC',
  fromNativeAmount: '123456789',
  toAddress: BTC_DESTINATION,
  memo: MEMO,
  inboundAddress: VAULT,
  inboundEntry,
  log,
  ...overrides
})

const expectError = async (
  promise: Promise<unknown>
): Promise<{ name: string; message: string }> => {
  try {
    await promise
  } catch (error: unknown) {
    return error as { name: string; message: string }
  }
  throw new Error('Expected the strategy to throw')
}

describe(`appendMayaRefundAddress`, function () {
  const refund = REFUND

  it('replaces the destination address with destination/refund', function () {
    const destination = 'XnzErKGuqcG5Ci5oTsQv7stwCBofgChu8s'
    const memo = `=:d:${destination}:0/1/1:ej:75`
    const result = appendMayaRefundAddress(memo, destination, refund)
    assert.equal(
      result,
      '=:d:XnzErKGuqcG5Ci5oTsQv7stwCBofgChu8s/t1MnUkHpi3Ampr9ZzAtnWHFbatsVF3hEvKL:0/1/1:ej:75'
    )
  })

  it('leaves the asset and trailing fields untouched', function () {
    const destination = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
    const memo = `=:e:${destination}::ej:75`
    const result = appendMayaRefundAddress(memo, destination, refund)
    const fields = result.split(':')
    // index 1 (asset) and the affiliate/bps tail are unchanged; only the
    // destination field (index 2) gains the refund.
    assert.equal(fields[1], 'e')
    assert.equal(fields[2], `${destination}/${refund}`)
    assert.equal(fields[4], 'ej')
    assert.equal(fields[5], '75')
  })

  it('returns the memo unchanged when the destination is not present', function () {
    const memo = '=:d:XnzErKGuqcG5Ci5oTsQv7stwCBofgChu8s:0/1/1:ej:75'
    assert.equal(appendMayaRefundAddress(memo, 'notinmemo', refund), memo)
    assert.equal(appendMayaRefundAddress('', 'notinmemo', refund), '')
  })
})

describe(`makeZcashShieldedMemoSpend`, function () {
  it('builds a two-payment ZIP-321 URI with the refund in the shielded memo', async function () {
    const override = await makeZcashShieldedMemoSpend(makeCtx())

    const memoWithRefund = `=:BTC.BTC:${BTC_DESTINATION}/${REFUND}:0/1/1:ej:50`
    const encodedMemo = base64urlnopad.encode(utf8.decode(memoWithRefund))
    assert.notInclude(encodedMemo, '=')
    assert.deepEqual(override, {
      memo: { type: 'text', value: '' },
      publicAddress: VAULT,
      otherParams: {
        zip321Uri:
          `zcash:?address=${VAULT}` +
          '&amount=1.23456789' +
          `&address.1=${MEMO_RECIPIENT}` +
          '&amount.1=0' +
          `&memo.1=${encodedMemo}`
      }
    })
    const uri = String(override.otherParams?.zip321Uri)
    const encoded = uri.slice(uri.indexOf('&memo.1=') + '&memo.1='.length)
    assert.equal(utf8.encode(base64urlnopad.decode(encoded)), memoWithRefund)
  })

  it('needs an inbound vault address', async function () {
    const error = await expectError(
      makeZcashShieldedMemoSpend(makeCtx({ inboundAddress: undefined }))
    )
    assert.equal(error.message, 'Invalid vault address')
  })

  it('refuses a shielded inbound vault', async function () {
    const error = await expectError(
      makeZcashShieldedMemoSpend(makeCtx({ inboundAddress: 'u1vault' }))
    )
    assert.equal(error.name, 'SwapCurrencyError')
  })

  it('refuses a vault that advertises no shielded memo address', async function () {
    const cases: unknown[] = [
      undefined,
      { ...inboundEntry, shielded_memo_config: undefined },
      {
        ...inboundEntry,
        shielded_memo_config: {
          ...inboundEntry.shielded_memo_config,
          enabled: false
        }
      },
      {
        ...inboundEntry,
        shielded_memo_config: {
          ...inboundEntry.shielded_memo_config,
          unified_address: ''
        }
      },
      { ...inboundEntry, shielded_memo_config: 'malformed' }
    ]
    for (const entry of cases) {
      const error = await expectError(
        makeZcashShieldedMemoSpend(makeCtx({ inboundEntry: entry }))
      )
      assert.equal(error.name, 'SwapCurrencyError')
    }
  })

  it('needs a transparent refund address on the source wallet', async function () {
    const error = await expectError(
      makeZcashShieldedMemoSpend(makeCtx({}, makeZecWallet()))
    )
    assert.equal(error.message, 'No address of type transparentAddress')
  })
})
