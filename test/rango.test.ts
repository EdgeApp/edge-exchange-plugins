import { assert } from 'chai'
import { describe, it } from 'mocha'

import {
  decodeTronApproval,
  hexToTronAddress
} from '../src/swap/defi/rango'

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
