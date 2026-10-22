import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapRequest,
  EdgeToken,
  EdgeTransaction,
  EdgeTxActionSwap
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeBridgelessPlugin } from '../src/swap/defi/bridgeless'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
// Zano's tokenId for Bridgeless-wrapped BTC
const ZANO_BTC =
  '040a180aca4194a158c17945dd115db42086f6f074c1f77838621a4927fffa91'
const BRIDGE_ADDRESS = '1E3TeJbW5iy6b2YLF427Za4HTaYQ3yFSUK'
const ZANO_ADDRESS =
  'ZxD22fFMb1qGdbyGKxVcEh8CqTRCPPEmpAuFa18GfJygRUN9jVbfJrm1JDn8VYDgCPHfAC5YNSp286Yswm999xff1rCfTgsse'
// Bitcoin engines report txids without a 0x prefix
const BROADCAST_TXID =
  '4b2554647d23fe9e204107174d7a99a4a4de8ecbaa3cf2954483926e04e8c5af'

interface FakeWalletOpts {
  pluginId: string
  currencyCode: string
  address: string
  tokens?: { [tokenId: string]: string }
}

const makeFakeWallet = (opts: FakeWalletOpts): EdgeCurrencyWallet => {
  const { address, currencyCode, pluginId, tokens = {} } = opts
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier: '100000000' }]
  }
  const allTokens: { [tokenId: string]: EdgeToken } = {}
  for (const tokenId of Object.keys(tokens)) {
    allTokens[tokenId] = {
      currencyCode: tokens[tokenId],
      displayName: tokens[tokenId],
      denominations: [{ name: tokens[tokenId], multiplier: '100000000' }],
      networkLocation: { contractAddress: tokenId }
    }
  }

  return ({
    id: `${pluginId}-wallet`,
    balanceMap: new Map(),
    currencyInfo,
    currencyConfig: {
      currencyInfo,
      allTokens,
      async getTokenId(token: EdgeToken) {
        return token.networkLocation?.contractAddress
      }
    },
    async getAddresses() {
      return [{ addressType: 'publicAddress', publicAddress: address }]
    },
    async makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
      return ({
        networkFee: '1000',
        savedAction: spendInfo.savedAction,
        assetAction: spendInfo.assetAction,
        tokenId: spendInfo.tokenId
      } as unknown) as EdgeTransaction
    },
    async signTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      return tx
    },
    async broadcastTx(tx: EdgeTransaction): Promise<EdgeTransaction> {
      // The swap helper reads the txid off the transaction it signed
      tx.txid = BROADCAST_TXID
      return tx
    },
    async saveTx(): Promise<void> {},
    async saveTxAction(): Promise<void> {}
  } as unknown) as EdgeCurrencyWallet
}

const tokenInfo = (
  address: string,
  chainId: string
): { [key: string]: unknown } => ({
  address,
  decimals: '8',
  chain_id: chainId,
  token_id: '1',
  commission_rate: '0.003',
  min_withdrawal_amount: '1000',
  is_wrapped: chainId === '2'
})

const makeFakeResponse = (body: unknown): unknown => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body)
})

const makePluginOpts = (submitterLog: unknown[]): EdgeCorePluginOptions =>
  (({
    initOptions: { referralId: 2 },
    io: {
      fetch: async (uri: string, opts?: { body?: string }) => {
        if (uri.includes('/api/bridgeless')) {
          submitterLog.push(JSON.parse(opts?.body ?? '{}'))
          return makeFakeResponse({})
        }
        if (uri.includes('/chains/')) {
          return makeFakeResponse({
            chain: {
              id: '0',
              type: 'BITCOIN',
              bridge_address: BRIDGE_ADDRESS,
              operator: 'operator',
              confirmations: 6,
              name: 'Bitcoin'
            }
          })
        }
        return makeFakeResponse({
          tokens: [
            {
              id: '1',
              info: [tokenInfo(ZERO_ADDRESS, '0'), tokenInfo(ZANO_BTC, '2')]
            }
          ],
          pagination: { next_key: null, total: '1' }
        })
      }
    }
  } as unknown) as EdgeCorePluginOptions)

describe('bridgeless approve', function () {
  it('returns the resolved order id instead of the quote placeholder', async function () {
    const submitterLog: unknown[] = []
    const request: EdgeSwapRequest = {
      fromWallet: makeFakeWallet({
        pluginId: 'bitcoin',
        currencyCode: 'BTC',
        address: 'bc1qexample'
      }),
      toWallet: makeFakeWallet({
        pluginId: 'zano',
        currencyCode: 'ZANO',
        address: ZANO_ADDRESS,
        tokens: { [ZANO_BTC]: 'BTCx' }
      }),
      fromTokenId: null,
      toTokenId: ZANO_BTC,
      nativeAmount: '7000000',
      quoteFor: 'from'
    }

    const quote = await makeBridgelessPlugin(
      makePluginOpts(submitterLog)
    ).fetchSwapQuote(request, undefined, { infoPayload: {} })
    const result = await quote.approve()

    const orderId = `0/0x${BROADCAST_TXID}/0`
    assert.equal(result.orderId, orderId)
    const savedAction = result.transaction.savedAction as EdgeTxActionSwap
    assert.equal(savedAction.orderId, orderId)
    assert.deepEqual(submitterLog, [
      { chainId: '0', txHash: BROADCAST_TXID, txNonce: '0' }
    ])
  })
})
