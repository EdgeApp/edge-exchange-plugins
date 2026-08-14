import { assert } from 'chai'
import { describe, it } from 'mocha'

import {
  asTronTransaction,
  checkRangoTronTransaction,
  RangoTronTransaction
} from '../src/swap/defi/rango'
import rangoTronSwaps from './rangoTronSwaps.json'

describe(`rango checkRangoTronTransaction`, function () {
  const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  const ROUTER = 'TGnC7LMji8hBpyvZt1TTEJhVpAZ5HFyJ3r'
  const OTHER_HEX = '6c4d3cb629599f55e634bcbe08c9ffc560373d77'
  const { trxToUsdt, usdtToTrx } = rangoTronSwaps

  /** A cleaned copy of a real Rango payload, edited by `edit` */
  const payload = (
    raw: unknown,
    edit: (tx: RangoTronTransaction) => void = () => {}
  ): RangoTronTransaction => {
    const tx = asTronTransaction(JSON.parse(JSON.stringify(raw)))
    edit(tx)
    return tx
  }

  const checkTrxSell = (tx: RangoTronTransaction): unknown =>
    checkRangoTronTransaction(tx, '0x0', null, trxToUsdt.amount)
  const checkUsdtSell = (tx: RangoTronTransaction): unknown =>
    checkRangoTronTransaction(tx, USDT, USDT, usdtToTrx.amount)

  const approvalValue = (
    tx: RangoTronTransaction
  ): RangoTronTransaction['raw_data']['contract'][0]['parameter']['value'] => {
    if (tx.approve_raw_data == null) throw new Error('Expected an approval')
    return tx.approve_raw_data.contract[0].parameter.value
  }

  it('passes a real TRX sell', function () {
    const tx = payload(trxToUsdt.tx)
    const checked = checkRangoTronTransaction(tx, '0x0', null, trxToUsdt.amount)
    assert.equal(checked.routerAddress, ROUTER)
    assert.equal(checked.swapContract, tx.raw_data.contract[0])
    assert.equal(checked.swapFeeLimit, trxToUsdt.tx.raw_data.fee_limit)
    assert.equal(checked.approval, undefined)
  })

  it('passes a real token sell and its approval', function () {
    const tx = payload(usdtToTrx.tx)
    const checked = checkRangoTronTransaction(tx, USDT, USDT, usdtToTrx.amount)
    assert.equal(checked.routerAddress, ROUTER)
    assert.equal(checked.swapFeeLimit, usdtToTrx.tx.raw_data.fee_limit)
    if (tx.approve_raw_data == null) throw new Error('Expected an approval')
    assert.deepEqual(checked.approval, {
      contract: tx.approve_raw_data.contract[0],
      feeLimit: usdtToTrx.tx.approve_raw_data.fee_limit,
      spenderAddress: ROUTER,
      tokenAddress: USDT
    })
  })

  it('rejects a TRX sell that sends more than the quote', function () {
    const tx = payload(trxToUsdt.tx, tx => {
      tx.raw_data.contract[0].parameter.value.call_value = 15000001
    })
    assert.throws(() => checkTrxSell(tx), /above the quoted 15000000/)
  })

  it('rejects a token sell that sends TRX', function () {
    const tx = payload(usdtToTrx.tx, tx => {
      tx.raw_data.contract[0].parameter.value.call_value = 1
    })
    assert.throws(() => checkUsdtSell(tx), /above the quoted 0/)
  })

  it('rejects a TRC10 token on the swap or the approval', function () {
    const onSwap = payload(trxToUsdt.tx, tx => {
      tx.raw_data.contract[0].parameter.value.call_token_value = 5000
    })
    assert.throws(() => checkTrxSell(onSwap), /attaches a TRC10 token/)

    const onApproval = payload(usdtToTrx.tx, tx => {
      approvalValue(tx).call_token_value = 5000
    })
    assert.throws(() => checkUsdtSell(onApproval), /attaches a TRC10 token/)
  })

  it('rejects a swap that calls the sold token', function () {
    const tx = payload(usdtToTrx.tx, tx => {
      tx.raw_data.contract[0].parameter.value.contract_address = approvalValue(
        tx
      ).contract_address
    })
    assert.throws(() => checkUsdtSell(tx), /calls the sold token contract/)
  })

  it('rejects a swap shaped like a transfer or an approval', function () {
    const selectors = [
      'a9059cbb',
      '23b872dd',
      '095ea7b3',
      '39509351',
      'd73dd623'
    ]
    for (const selector of selectors) {
      const tx = payload(trxToUsdt.tx, tx => {
        const value = tx.raw_data.contract[0].parameter.value
        value.data = `${selector}${value.data.slice(8)}`
      })
      assert.throws(() => checkTrxSell(tx), /not a swap/, selector)
    }
  })

  it('rejects an approval for another spender', function () {
    const tx = payload(usdtToTrx.tx, tx => {
      const value = approvalValue(tx)
      value.data = `${value.data.slice(0, 32)}${OTHER_HEX}${value.data.slice(
        72
      )}`
    })
    assert.throws(() => checkUsdtSell(tx), /rather than the swap contract/)
  })

  it('rejects an approval for another token', function () {
    const tx = payload(usdtToTrx.tx, tx => {
      approvalValue(tx).contract_address = `41${OTHER_HEX}`
    })
    assert.throws(() => checkUsdtSell(tx), /rather than the asset being sold/)
  })

  it('rejects an approval for more than the quote', function () {
    const tx = payload(usdtToTrx.tx, tx => {
      const value = approvalValue(tx)
      value.data = `${value.data.slice(0, 72)}${(5000001)
        .toString(16)
        .padStart(64, '0')}`
    })
    assert.throws(() => checkUsdtSell(tx), /allows 5000001, above the quoted/)
  })

  it('rejects an approval that sends TRX', function () {
    const tx = payload(usdtToTrx.tx, tx => {
      approvalValue(tx).call_value = 1
    })
    assert.throws(() => checkUsdtSell(tx), /sends TRX along with the approve/)
  })
})
