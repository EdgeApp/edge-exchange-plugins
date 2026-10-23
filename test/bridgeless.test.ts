import { assert } from 'chai'
import {
  asMaybeSwapAboveLimitError,
  asMaybeSwapBelowLimitError,
  SwapAboveLimitError,
  SwapBelowLimitError
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { getBridgelessAmounts } from '../src/swap/defi/bridgeless'

// Limits as returned by the live /cosmos/bridge/tokens endpoint:
const usdt = {
  fromDecimals: 6,
  toDecimals: 6,
  commissionRate: '0.003',
  minWithdrawalAmount: '20000000',
  maxWithdrawalAmount: '2000212022'
}

// Ethereum ETH (18 decimals) to Zano ETH (6 decimals):
const ethToZano = {
  fromDecimals: 18,
  toDecimals: 6,
  commissionRate: '0.003',
  minWithdrawalAmount: '4900',
  maxWithdrawalAmount: '77541620'
}

// Zano ETH (6 decimals) to Ethereum ETH (18 decimals):
const zanoToEth = {
  fromDecimals: 6,
  toDecimals: 18,
  commissionRate: '0.003',
  minWithdrawalAmount: '49000000000',
  maxWithdrawalAmount: '775416204647844730'
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

const catchAboveLimit = (fn: () => unknown): SwapAboveLimitError => {
  const error = asMaybeSwapAboveLimitError(catchError(fn))
  if (error == null) assert.fail('Expected a SwapAboveLimitError')
  return error
}

describe('getBridgelessAmounts', function () {
  it('rejects a payout below the minimum', function () {
    const { nativeMin, direction } = catchBelowLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'to',
        nativeAmount: '20199999'
      })
    )
    assert.equal(nativeMin, '20200000')
    assert.equal(direction, 'to')

    const amounts = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'to',
      nativeAmount: nativeMin
    })
    assert.deepEqual(amounts, { fromAmount: '20260782', toAmount: '20200000' })
  })

  it('rejects a deposit below the minimum', function () {
    const { nativeMin, direction } = catchBelowLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'from',
        nativeAmount: '20260781'
      })
    )
    assert.equal(nativeMin, '20260782')
    assert.equal(direction, 'from')

    // The reported minimum pays out exactly the minimum after commission:
    const amounts = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'from',
      nativeAmount: nativeMin
    })
    assert.equal(amounts.toAmount, '20200000')
  })

  it('quotes a deposit at the cap', function () {
    const amounts = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'from',
      nativeAmount: '1980209901'
    })
    assert.deepEqual(amounts, {
      fromAmount: '1980209901',
      toAmount: '1974269272'
    })
  })

  it('rejects a deposit over the cap', function () {
    const { nativeMax, direction } = catchAboveLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'from',
        nativeAmount: '1980209902'
      })
    )
    assert.equal(nativeMax, '1980209901')
    assert.equal(direction, 'from')
  })

  it('keeps a margin inside the published limits', function () {
    const above = catchAboveLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'from',
        nativeAmount: usdt.maxWithdrawalAmount
      })
    )
    assert.equal(above.nativeMax, '1980209901')

    const below = catchBelowLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'to',
        nativeAmount: usdt.minWithdrawalAmount
      })
    )
    assert.equal(below.nativeMin, '20200000')
  })

  it('quotes a payout under the cap', function () {
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

  it('rejects a payout whose deposit is over the cap', function () {
    const { nativeMax, direction } = catchAboveLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'to',
        nativeAmount: '2000212022'
      })
    )
    assert.equal(nativeMax, '1974269272')
    assert.equal(direction, 'to')

    // The reported limit itself quotes, and one unit more does not:
    const amounts = getBridgelessAmounts({
      ...usdt,
      quoteFor: 'to',
      nativeAmount: nativeMax
    })
    assert.equal(amounts.fromAmount, '1980209901')
    catchAboveLimit(() =>
      getBridgelessAmounts({
        ...usdt,
        quoteFor: 'to',
        nativeAmount: '1974269273'
      })
    )
  })

  it('caps a deposit with more decimals than the payout', function () {
    // Dust below the payout's precision is dropped, so it stays in the cap:
    const amounts = getBridgelessAmounts({
      ...ethToZano,
      quoteFor: 'from',
      nativeAmount: '76766203999999999999'
    })
    assert.equal(amounts.toAmount, '76535905')

    const { nativeMax, direction } = catchAboveLimit(() =>
      getBridgelessAmounts({
        ...ethToZano,
        quoteFor: 'from',
        nativeAmount: '76766204000000000000'
      })
    )
    assert.equal(nativeMax, '76766203000000000000')
    assert.equal(direction, 'from')
    getBridgelessAmounts({
      ...ethToZano,
      quoteFor: 'from',
      nativeAmount: nativeMax
    })
  })

  it('caps a payout with more decimals than the deposit', function () {
    const { nativeMax, direction } = catchAboveLimit(() =>
      getBridgelessAmounts({
        ...zanoToEth,
        quoteFor: 'to',
        nativeAmount: '775000000000000000'
      })
    )
    assert.equal(nativeMax, '765359014000000000')
    assert.equal(direction, 'to')

    // The deposit rounds up to the next Zano unit and still fits the cap:
    const amounts = getBridgelessAmounts({
      ...zanoToEth,
      quoteFor: 'to',
      nativeAmount: nativeMax
    })
    assert.equal(amounts.fromAmount, '767662')
    catchAboveLimit(() =>
      getBridgelessAmounts({
        ...zanoToEth,
        quoteFor: 'to',
        nativeAmount: '765359014000000001'
      })
    )

    const fromError = catchAboveLimit(() =>
      getBridgelessAmounts({
        ...zanoToEth,
        quoteFor: 'from',
        nativeAmount: '767663'
      })
    )
    assert.equal(fromError.nativeMax, '767662')
  })

  it('treats a zero or missing cap as no limit', function () {
    for (const maxWithdrawalAmount of ['0', undefined]) {
      const amounts = getBridgelessAmounts({
        ...usdt,
        maxWithdrawalAmount,
        quoteFor: 'from',
        nativeAmount: '1000000000000'
      })
      assert.equal(amounts.fromAmount, '1000000000000')
    }
  })
})
