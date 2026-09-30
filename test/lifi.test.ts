import { assert } from 'chai'
import {
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeTokenMap,
  EdgeTransaction
} from 'edge-core-js/types'
import { describe, it } from 'mocha'

import { makeLifiPlugin } from '../src/swap/defi/lifi'

/** HyperCore USDC, as the currency plugin stores its 16-byte token id. */
const HYPERCORE_USDC = '0x6d1e7cde53ba9467b783cb7c530ce054'
const ARBITRUM_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'

const makeFakeWallet = (
  pluginId: string,
  currencyCode: string,
  allTokens: EdgeTokenMap = {}
): EdgeCurrencyWallet => {
  const currencyInfo = {
    pluginId,
    currencyCode,
    denominations: [{ name: currencyCode, multiplier: '100000000' }]
  }
  return ({
    id: `${pluginId}-wallet`,
    currencyInfo,
    currencyConfig: {
      // `SwapCurrencyError` reads the pluginId through here.
      currencyInfo,
      allTokens
    },
    async getAddresses() {
      return [
        {
          addressType: 'publicAddress',
          publicAddress: '0x1234567890123456789012345678901234567890'
        }
      ]
    }
  } as unknown) as EdgeCurrencyWallet
}

const makeToken = (
  currencyCode: string,
  contractAddress: string,
  multiplier = '1000000'
): EdgeTokenMap[string] => ({
  currencyCode,
  displayName: currencyCode,
  denominations: [{ name: currencyCode, multiplier }],
  networkLocation: { contractAddress }
})

const arbitrumWallet = makeFakeWallet('arbitrum', 'ETH', {
  usdc: makeToken('USDC', ARBITRUM_USDC)
})
const hyperCoreWallet = makeFakeWallet('hypercore', 'HYPE', {
  usdc: makeToken('USDC', HYPERCORE_USDC, '100000000')
})

/**
 * Records every requested URI and fails each one, so a quote stops right
 * after LI.FI is asked for it.
 */
const makePlugin = (uris: string[]): ReturnType<typeof makeLifiPlugin> =>
  makeLifiPlugin(({
    io: {
      fetchCors: async (uri: string) => {
        uris.push(uri)
        return { ok: false, status: 400, text: async () => 'test' }
      }
    },
    initOptions: {},
    log: Object.assign(() => {}, { warn() {} })
  } as unknown) as EdgeCorePluginOptions)

const fetchQuoteParams = async (
  request: EdgeSwapRequest
): Promise<URLSearchParams> => {
  const uris: string[] = []
  await makePlugin(uris)
    .fetchSwapQuote(request, undefined, { infoPayload: {} })
    // The fake fails every request, so the quote always rejects:
    .catch(() => {})
  const quoteUri = uris.find(uri => uri.includes('v1/quote?'))
  if (quoteUri == null) throw new Error('No quote was requested')
  return new URLSearchParams(quoteUri.split('?')[1])
}

const WALLET_ADDRESS = '0x1234567890123456789012345678901234567890'

/** Shaped like the typed data LI.FI returns for a 15 USDC route. */
const makeTypedData = (
  sendAsset: { [key: string]: unknown } = {}
): Array<{ primaryType: string; message: { [key: string]: unknown } }> => [
  {
    primaryType: 'NonceMapping',
    message: {
      chainId: 'hyperliquid',
      wallet: WALLET_ADDRESS,
      depositor: WALLET_ADDRESS,
      nonce: 1759200000000,
      id: '0xrequest'
    }
  },
  {
    primaryType: 'HyperliquidTransaction:SendAsset',
    message: {
      type: 'sendAsset',
      hyperliquidChain: 'Mainnet',
      destination: '0x00000000000000000000000000000000000000de',
      sourceDex: 'spot',
      destinationDex: '',
      token: `USDC:${HYPERCORE_USDC}`,
      amount: '15',
      fromSubAccount: '',
      nonce: 1759200000000,
      ...sendAsset
    }
  }
]

/**
 * Quotes 15 HyperCore USDC to Arbitrum through a LI.FI message step,
 * recording what the wallet signs and saves and what the relay receives.
 */
const quoteMessageRoute = async (
  typedData: unknown[],
  statusBody: unknown = { status: 'PENDING', sending: { txHash: '0xhash' } },
  opts: { fromWallet?: EdgeCurrencyWallet } = {}
): Promise<{
  quote: EdgeSwapQuote
  relayBodies: any[]
  saved: EdgeTransaction[]
  signed: string[]
}> => {
  const step = {
    id: 'step-id',
    type: 'lifi',
    tool: 'relaydepository',
    executionType: 'message',
    estimate: {
      fromAmount: '1500000000',
      toAmount: '14992534',
      toAmountMin: '14917572',
      approvalAddress: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
      executionDuration: 10
    },
    includedSteps: [{ toolDetails: { name: 'Relay' } }],
    transactionRequest: null,
    typedData
  }

  const relayBodies: any[] = []
  const signed: string[] = []
  const saved: EdgeTransaction[] = []
  const fromWallet = ({
    ...(opts.fromWallet ?? hyperCoreWallet),
    async signMessage(message: string, signOpts: any) {
      assert.isTrue(signOpts.otherParams.typedData)
      signed.push(JSON.parse(message).primaryType)
      return `0xsig${signed.length}`
    },
    async saveTx(tx: EdgeTransaction) {
      saved.push(tx)
    }
  } as unknown) as EdgeCurrencyWallet

  const plugin = makeLifiPlugin(({
    io: {
      fetchCors: async (uri: string, fetchOpts?: any) => {
        const json = (body: unknown): unknown => ({
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body)
        })
        if (uri.includes('v1/quote?')) return json(step)
        if (uri.includes('v1/advanced/relay')) {
          relayBodies.push(JSON.parse(fetchOpts.body))
          return json({ status: 'ok', data: { taskId: 'task-id' } })
        }
        if (uri.includes('v1/status?taskId=task-id')) return json(statusBody)
        return { ok: false, status: 400, text: async () => 'test' }
      }
    },
    initOptions: {},
    log: Object.assign(() => {}, { warn() {} })
  } as unknown) as EdgeCorePluginOptions)

  const quote = await plugin.fetchSwapQuote(
    {
      fromWallet,
      fromTokenId: 'usdc',
      toWallet: arbitrumWallet,
      toTokenId: 'usdc',
      nativeAmount: '1500000000',
      quoteFor: 'from'
    },
    undefined,
    { infoPayload: {} }
  )
  return { quote, relayBodies, saved, signed }
}

describe('lifi HyperCore', function () {
  it('names HyperCore tokens by their padded token id', async function () {
    const params = await fetchQuoteParams({
      fromWallet: arbitrumWallet,
      fromTokenId: 'usdc',
      toWallet: hyperCoreWallet,
      toTokenId: 'usdc',
      nativeAmount: '10000000',
      quoteFor: 'from'
    })
    assert.equal(params.get('toChain'), 'hpl')
    assert.equal(params.get('toToken'), `${HYPERCORE_USDC}00000000`)
    assert.equal(params.get('denyBridges'), 'mayan')
  })

  it('names HyperCore HYPE by its padded token id', async function () {
    const params = await fetchQuoteParams({
      fromWallet: arbitrumWallet,
      fromTokenId: 'usdc',
      toWallet: hyperCoreWallet,
      toTokenId: null,
      nativeAmount: '10000000',
      quoteFor: 'from'
    })
    assert.equal(
      params.get('toToken'),
      '0x0D01DC56DcaaCa66aD901c959B4011ec00000000'
    )
  })

  it('asks for message routes out of HyperCore', async function () {
    const params = await fetchQuoteParams({
      fromWallet: hyperCoreWallet,
      fromTokenId: 'usdc',
      toWallet: arbitrumWallet,
      toTokenId: 'usdc',
      nativeAmount: '1500000000',
      quoteFor: 'from'
    })
    assert.equal(params.get('fromChain'), 'hpl')
    assert.equal(params.get('fromToken'), `${HYPERCORE_USDC}00000000`)
    assert.equal(params.get('executionType'), 'all')
    assert.equal(params.get('denyBridges'), 'mayan')
  })

  it('relays signed messages out of HyperCore', async function () {
    this.timeout(10000)
    const route = await quoteMessageRoute(makeTypedData())
    const { quote, relayBodies, saved, signed } = route
    assert.equal(quote.toNativeAmount, '14992534')
    assert.equal(quote.networkFee.nativeAmount, '0')

    const result = await quote.approve({
      metadata: { name: 'Swap', notes: 'caller note' }
    })
    assert.deepEqual(signed, [
      'NonceMapping',
      'HyperliquidTransaction:SendAsset'
    ])
    assert.deepEqual(
      relayBodies[0].typedData.map((entry: any) => entry.signature),
      ['0xsig1', '0xsig2']
    )
    assert.equal(relayBodies[0].id, 'step-id')
    assert.equal(result.orderId, 'task-id')
    assert.equal(result.transaction.txid, '0xhash')
    assert.equal(result.transaction.nativeAmount, '-1500000000')
    assert.equal(result.transaction.metadata?.name, 'Swap')
    assert.match(
      result.transaction.metadata?.notes ?? '',
      /^DEX Providers: [^\n]+\n\ncaller note$/
    )
    assert.deepEqual(saved, [result.transaction])
  })

  it('saves a relayed transfer that failed after sending', async function () {
    this.timeout(10000)
    const { quote, saved } = await quoteMessageRoute(makeTypedData(), {
      status: 'FAILED',
      sending: { txHash: '0xhash' }
    })
    const result = await quote.approve()
    assert.equal(result.transaction.txid, '0xhash')
    assert.deepEqual(saved, [result.transaction])
  })

  it('refuses a transfer larger than the quote', async function () {
    const error = await quoteMessageRoute(
      makeTypedData({ amount: '15.00000001' })
    ).catch((error: unknown) => error)
    assert.equal((error as Error).name, 'SwapCurrencyError')
  })

  it('refuses a transfer of another token', async function () {
    const error = await quoteMessageRoute(
      makeTypedData({ token: 'HYPE:0x0d01dc56dcaaca66ad901c959b4011ec' })
    ).catch((error: unknown) => error)
    assert.equal((error as Error).name, 'SwapCurrencyError')
  })

  it('refuses a nonce mapping for another wallet', async function () {
    const typedData = makeTypedData()
    typedData[0].message.depositor =
      '0x0000000000000000000000000000000000000001'
    const error = await quoteMessageRoute(typedData).catch(
      (error: unknown) => error
    )
    assert.equal((error as Error).name, 'SwapCurrencyError')
  })

  it('refuses Hyperliquid trading steps', async function () {
    const typedData = [
      ...makeTypedData(),
      {
        primaryType: 'HyperliquidTransaction:ApproveAgent',
        message: { agentAddress: '0x0000000000000000000000000000000000000001' }
      }
    ]
    const error = await quoteMessageRoute(typedData).catch(
      (error: unknown) => error
    )
    assert.equal((error as Error).name, 'SwapCurrencyError')
  })

  it('refuses message routes from other chains', async function () {
    const error = await quoteMessageRoute(makeTypedData(), undefined, {
      fromWallet: arbitrumWallet
    }).catch((error: unknown) => error)
    assert.equal((error as Error).name, 'SwapCurrencyError')
  })
})
