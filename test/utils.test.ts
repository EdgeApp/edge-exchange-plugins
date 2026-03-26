import { assert } from 'chai'
import { describe, it } from 'mocha'

import { scaleNativeAmount } from '../src/swap/defi/bridgeless'
import { makeQueryParams } from '../src/util/utils'

describe(`makeQueryParams`, function () {
  it('simple query params', function () {
    const queryString = makeQueryParams({
      stringKey: 'value1',
      numberKey: 100,
      nullKey: null,
      boolKey: false
    })
    assert.equal(
      queryString,
      'stringKey=value1&numberKey=100&nullKey&boolKey=false&amount=1'
    )
  })
})

describe(`scaleNativeAmount`, function () {
  it('returns the same amount when decimals match', function () {
    assert.equal(scaleNativeAmount('12345', 6, 6, 'down'), '12345')
  })

  it('expands amount when destination has more decimals', function () {
    assert.equal(scaleNativeAmount('12345', 6, 18, 'down'), '12345000000000000')
  })

  it('truncates amount when destination has fewer decimals', function () {
    assert.equal(
      scaleNativeAmount('20005000000000000000', 18, 6, 'down'),
      '20005000'
    )
  })

  it('rounds up when truncated remainder is non-zero', function () {
    assert.equal(scaleNativeAmount('1234567', 6, 3, 'up'), '1235')
  })

  it('does not round up when truncated remainder is zero', function () {
    assert.equal(scaleNativeAmount('1234000', 6, 3, 'up'), '1234')
  })

  it('returns one when rounding up a tiny amount below precision', function () {
    assert.equal(scaleNativeAmount('1', 18, 6, 'up'), '1')
  })

  it('returns zero when rounding down a tiny amount below precision', function () {
    assert.equal(scaleNativeAmount('1', 18, 6, 'down'), '0')
  })
})
