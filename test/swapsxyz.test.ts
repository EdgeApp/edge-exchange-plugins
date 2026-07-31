import { assert } from 'chai'
import { describe, it } from 'mocha'

import {
  makeSwapsXyzSpendInfo,
  SwapsXyzAction
} from '../src/swap/defi/swapsxyz'

const USDC = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDT = 'dac17f958d2ee523a2206206994597c13d831ec7'
const ROUTER = '0x1b6257CAE4192e62B629eFCa21771be3D759183D'
const SENDER = '0x0b0901e9cef9eaed5753519177e3c7cfd0ef96ef'
const RECIPIENT = '0x1234567890123456789012345678901234567890'

const makeAmount = (
  amount: string,
  address: string,
  isNative: boolean,
  decimals: number,
  symbol: string
): SwapsXyzAction['amountIn'] => ({
  amount,
  address,
  chainId: 1,
  isNative,
  decimals,
  symbol
})

describe('swapsxyz makeSwapsXyzSpendInfo', function () {
  it('native ethereum to usdc token', function () {
    const action: SwapsXyzAction = {
      tx: {
        to: ROUTER,
        data: '0x9be111d1deadbeef',
        value: '10000000000000000',
        chainId: 1
      },
      txId: '0x99b16cbed2445ffdc34133e030cdda451bcdd73c',
      amountIn: makeAmount(
        '10000000000000000',
        '0x0000000000000000000000000000000000000000',
        true,
        18,
        'ETH'
      ),
      amountOut: makeAmount('19156417', `0x${USDC}`, false, 6, 'USDC'),
      amountOutMin: makeAmount('18964852', `0x${USDC}`, false, 6, 'USDC'),
      vmId: 'evm',
      requiresTokenApproval: false,
      executionsType: 'DEFAULT'
    }

    const spendInfo = makeSwapsXyzSpendInfo({
      action,
      fromPluginId: 'ethereum',
      toPluginId: 'ethereum',
      fromTokenId: null,
      toTokenId: USDC,
      fromAddress: SENDER,
      toAddress: RECIPIENT,
      toWalletId: 'wallet-eth'
    })

    assert.deepEqual(spendInfo, {
      tokenId: null,
      // Native source: the wallet must forward tx.value with the calldata.
      spendTargets: [
        { nativeAmount: '10000000000000000', publicAddress: ROUTER }
      ],
      memos: [{ type: 'hex', value: '9be111d1deadbeef' }],
      networkFeeOption: 'high',
      assetAction: { assetActionType: 'swap' },
      savedAction: {
        actionType: 'swap',
        swapInfo: {
          pluginId: 'swapsxyz',
          isDex: true,
          displayName: 'swaps.xyz',
          supportEmail: 'support@edge.app'
        },
        orderId: '0x99b16cbed2445ffdc34133e030cdda451bcdd73c',
        orderUri:
          'https://explorer.swaps.xyz/tx/0x99b16cbed2445ffdc34133e030cdda451bcdd73c',
        isEstimate: true,
        toAsset: {
          pluginId: 'ethereum',
          tokenId: USDC,
          nativeAmount: '19156417'
        },
        fromAsset: {
          pluginId: 'ethereum',
          tokenId: null,
          nativeAmount: '10000000000000000'
        },
        payoutAddress: RECIPIENT,
        payoutWalletId: 'wallet-eth',
        refundAddress: SENDER
      }
    })
  })

  it('usdc token to usdt token', function () {
    const action: SwapsXyzAction = {
      tx: {
        to: ROUTER,
        data: '0x9be111d1cafe',
        value: '0',
        chainId: 1
      },
      txId: '0xbd5a71f0d86a654a5bb8ed647cf2a9d2f27629ba',
      amountIn: makeAmount('100000000', `0x${USDC}`, false, 6, 'USDC'),
      amountOut: makeAmount('100054660', `0x${USDT}`, false, 6, 'USDT'),
      amountOutMin: makeAmount('99054113', `0x${USDT}`, false, 6, 'USDT'),
      vmId: 'evm',
      requiresTokenApproval: true,
      executionsType: 'DEFAULT'
    }

    const spendInfo = makeSwapsXyzSpendInfo({
      action,
      fromPluginId: 'ethereum',
      toPluginId: 'ethereum',
      fromTokenId: USDC,
      toTokenId: USDT,
      fromAddress: SENDER,
      toAddress: SENDER,
      toWalletId: 'wallet-eth'
    })

    // Token source: nativeAmount is the ERC20 amount (tx.value is 0) and the
    // spend is scoped to the source tokenId.
    assert.strictEqual(spendInfo.tokenId, USDC)
    assert.deepEqual(spendInfo.spendTargets, [
      { nativeAmount: '100000000', publicAddress: ROUTER }
    ])
    assert.deepEqual(spendInfo.memos, [{ type: 'hex', value: '9be111d1cafe' }])
    const savedAction = spendInfo.savedAction
    assert.isNotNull(savedAction)
    if (savedAction != null && savedAction.actionType === 'swap') {
      assert.strictEqual(savedAction.fromAsset.nativeAmount, '100000000')
      assert.strictEqual(savedAction.toAsset.nativeAmount, '100054660')
      assert.strictEqual(savedAction.orderId, action.txId)
    }
  })
})
