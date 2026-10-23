import { assert } from 'chai'
import {
  asMaybeSwapBelowLimitError,
  SwapBelowLimitError
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { getBridgelessAmounts } from '../src/swap/defi/bridgeless'

// Limits as returned by the live /cosmos/bridge/tokens endpoint:
const usdt = {
  fromDecimals: 6,
  toDecimals: 6,
  commissionRate: '0.003',
  minWithdrawalAmount: '20000000'
}

const catchError = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (error: unknown) {
    return error
  }
  assert.fail('Expected an error')
}

const catchBelowLimit = (fn: () => unknown): SwapBelowLimitError => {
  const error = asMaybeSwapBelowLimitError(catchError(fn))
  if (error == null) assert.fail('Expected a SwapBelowLimitError')
  return error
}

describe('getBridgelessAmounts', function () {
  it('rejects a payout below the minimum', function () {
    const { nativeMin, direction } = catchBelowLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'to',
        nativeAmount: '19999999'
      })
    )
    assert.equal(nativeMin, '20000000')
    assert.equal(direction, 'to')

    const amounts = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'to',
      nativeAmount: nativeMin
    })
    assert.deepEqual(amounts, { fromAmount: '20060180', toAmount: '20000000' })
  })

  it('rejects a deposit below the minimum', function () {
    const { nativeMin, direction } = catchBelowLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'from',
        nativeAmount: '20060179'
      })
    )
    assert.equal(nativeMin, '20060180')
    assert.equal(direction, 'from')

    // The reported minimum pays out exactly the minimum after commission:
    const amounts = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'from',
      nativeAmount: nativeMin
    })
    assert.equal(amounts.toAmount, '20000000')
  })

  it('quotes a payout', function () {
    const amounts = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'to',
      nativeAmount: '1000000000'
    })
    assert.deepEqual(amounts, {
      fromAmount: '1003009027',
      toAmount: '1000000000'
    })

    // The deposit is the smallest that pays out the requested amount:
    const short = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'from',
      nativeAmount: '1003009026'
    })
    assert.equal(short.toAmount, '999999999')
  })
})
