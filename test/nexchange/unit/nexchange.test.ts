import { assert } from 'chai'
import { describe, it } from 'mocha'

import {
  MAINNET_CODE_TRANSCRIPTION,
  swapInfo
} from '../../../src/swap/central/nexchange'

describe('Nexchange Unit Tests', function () {
  describe('swapInfo', function () {
    it('should have correct plugin metadata', function () {
      assert.equal(swapInfo.pluginId, 'nexchange')
      assert.equal(swapInfo.isDex, false)
      assert.equal(swapInfo.displayName, 'n.exchange')
      assert.equal(swapInfo.supportEmail, 'support@n.exchange')
    })
  })

  describe('MAINNET_CODE_TRANSCRIPTION', function () {
    it('should map all supported networks correctly', function () {
      assert.equal(MAINNET_CODE_TRANSCRIPTION.bitcoin, 'BTC')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.ethereum, 'ETH')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.avalanche, 'AVAXC')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.polygon, 'POL')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.arbitrum, 'ARB')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.optimism, 'OP')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.tron, 'TRON')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.solana, 'SOL')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.fantom, 'FTM')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.binancesmartchain, 'BSC')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.base, 'BASE')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.bitcoincash, 'BCH')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.dash, 'DASH')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.dogecoin, 'DOGE')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.polkadot, 'DOT')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.eos, 'EOS')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.ton, 'TON')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.hedera, 'HBAR')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.litecoin, 'LTC')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.stellar, 'XLM')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.ripple, 'XRP')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.tezos, 'XTZ')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.zcash, 'ZEC')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.cardano, 'ADA')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.ethereumclassic, 'ETC')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.sonic, 'SONIC')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.algorand, 'ALGO')
      assert.equal(MAINNET_CODE_TRANSCRIPTION.cosmoshub, 'ATOM')
    })

    it('should map unsupported networks to null', function () {
      assert.equal(MAINNET_CODE_TRANSCRIPTION.monero, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.axelar, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.binance, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.bitcoingold, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.celo, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.coreum, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.digibyte, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.ecash, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.ethereumpow, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.filecoin, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.fio, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.osmosis, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.piratechain, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.pulsechain, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.ravencoin, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.rsk, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.sui, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.telos, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.thorchainrune, null)
      assert.equal(MAINNET_CODE_TRANSCRIPTION.zksync, null)
    })
  })
})
