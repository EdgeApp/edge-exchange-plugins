import { assert } from 'chai'
import { describe, it } from 'mocha'

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
