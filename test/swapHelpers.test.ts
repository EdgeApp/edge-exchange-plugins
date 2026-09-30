import { assert } from 'chai'
import { EdgeCurrencyWallet, EdgeTransaction } from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { getSwapNetworkFee } from '../src/util/swapHelpers'

const wallet = ({
  currencyInfo: { currencyCode: 'HYPE' },
  currencyConfig: {
    allTokens: {
      usdc: { currencyCode: 'USDC' }
    }
  }
} as unknown) as EdgeCurrencyWallet

const makeTx = (tx: Partial<EdgeTransaction>): EdgeTransaction =>
  (({ networkFee: '0', networkFees: [], ...tx } as unknown) as EdgeTransaction)

describe(`getSwapNetworkFee`, function () {
  it('totals parent currency fees', function () {
    const fee = getSwapNetworkFee(wallet, [
      makeTx({ networkFee: '5' }),
      makeTx({ networkFee: '100', parentNetworkFee: '7' })
    ])
    assert.deepEqual(fee, {
      currencyCode: 'HYPE',
      nativeAmount: '12',
      tokenId: null
    })
  })

  it('reports a fee charged in the sent token', function () {
    const fee = getSwapNetworkFee(wallet, [
      makeTx({
        networkFee: '100000000',
        networkFees: [{ nativeAmount: '100000000', tokenId: 'usdc' }]
      })
    ])
    assert.deepEqual(fee, {
      currencyCode: 'USDC',
      nativeAmount: '100000000',
      tokenId: 'usdc'
    })
  })

  it('reports a token fee when sending a different asset', function () {
    const fee = getSwapNetworkFee(wallet, [
      makeTx({
        networkFee: '0',
        networkFees: [{ nativeAmount: '100000000', tokenId: 'usdc' }]
      })
    ])
    assert.deepEqual(fee, {
      currencyCode: 'USDC',
      nativeAmount: '100000000',
      tokenId: 'usdc'
    })
  })

  it('falls back to the parent currency when fee assets differ', function () {
    const fee = getSwapNetworkFee(wallet, [
      makeTx({
        networkFee: '3',
        networkFees: [{ nativeAmount: '3', tokenId: null }]
      }),
      makeTx({
        networkFee: '4',
        networkFees: [{ nativeAmount: '100000000', tokenId: 'usdc' }]
      })
    ])
    assert.deepEqual(fee, {
      currencyCode: 'HYPE',
      nativeAmount: '7',
      tokenId: null
    })
  })

  it('tolerates transactions without networkFees', function () {
    const fee = getSwapNetworkFee(wallet, [
      ({ networkFee: '9' } as unknown) as EdgeTransaction
    ])
    assert.deepEqual(fee, {
      currencyCode: 'HYPE',
      nativeAmount: '9',
      tokenId: null
    })
  })
})
