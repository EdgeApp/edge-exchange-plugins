import { base16, base58 } from '@scure/base'
import { add, floor, lt, mul, sub } from 'biggystring'
import {
  asArray,
  asBoolean,
  asEither,
  asNull,
  asNumber,
  asObject,
  asString
} from 'cleaners'
import {
  EdgeAssetAction,
  EdgeCorePluginOptions,
  EdgeCurrencyWallet,
  EdgeFetchFunction,
  EdgeSpendInfo,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeToken,
  EdgeTokenId,
  EdgeTxActionSwap,
  SwapBelowLimitError,
  SwapCurrencyError
} from 'edge-core-js/types'

import {
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress } from '../../util/utils'
import { EdgeSwapRequestPlugin, MakeTxParams } from '../types'

const pluginId = 'bridgeless'

const swapInfo: EdgeSwapInfo = {
  pluginId,
  displayName: 'Bridgeless',
  isDex: true,
  supportEmail: 'support@edge.com'
}

const BASE_URL = 'https://rpc-api.node0.mainnet.bridgeless.com'
const ORDER_URL = 'https://tss1.mainnet.bridgeless.com'
const AUTO_BOT_URL = 'https://autobot-wusa1.edge.app'

const EDGE_PLUGINID_CHAINID_MAP: Record<string, string> = {
  bitcoin: '0',
  zano: '2'
}

const asTokenInfo = asObject({
  address: asString,
  decimals: asString,
  chain_id: asString,
  token_id: asString,
  is_wrapped: asBoolean
})
type TokenInfo = ReturnType<typeof asTokenInfo>

const asToken = asObject({
  id: asString,
  // metadata: {
  //   name: 'Bitcoin',
  //   symbol: 'BTC',
  //   uri: 'https://avatars.githubusercontent.com/u/44211915?s=200&v=4',
  //   dex_name: ''
  // },
  info: asArray(asTokenInfo),
  commission_rate: asString //  '0.01'
})
type Token = ReturnType<typeof asToken>

const asPagination = asObject({
  next_key: asEither(asString, asNull),
  total: asString
})

const asBridgeChain = asObject({
  chain: asObject({
    id: asString,
    type: asString,
    bridge_address: asString,
    operator: asString,
    confirmations: asNumber,
    name: asString
  })
})

const asBridgeTokens = asObject({
  tokens: asArray(asToken),
  pagination: asPagination
})

const fetchBridgeless = async (
  fetch: EdgeFetchFunction,
  path: string
): Promise<unknown> => {
  const res = await fetch(`${BASE_URL}/cosmos/bridge/${path}`)
  if (!res.ok) {
    const message = await res.text()
    throw new Error(`Bridgeless could not fetch ${path}: ${message}`)
  }
  const json = await res.json()
  return json
}

export function makeBridgelessPlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  const fetchSwapQuoteInner = async (
    request: EdgeSwapRequestPlugin
  ): Promise<SwapOrder> => {
    const toAddress = await getAddress(request.toWallet)

    const fromChainId =
      EDGE_PLUGINID_CHAINID_MAP[request.fromWallet.currencyInfo.pluginId]
    const toChainId =
      EDGE_PLUGINID_CHAINID_MAP[request.toWallet.currencyInfo.pluginId]
    if (fromChainId == null || toChainId == null || fromChainId === toChainId) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromChainInfoRaw = await fetchBridgeless(
      opts.io.fetch,
      `/chains/${fromChainId}`
    )
    const bridgeAddress = asBridgeChain(fromChainInfoRaw).chain.bridge_address

    const getTokenId = async (
      wallet: EdgeCurrencyWallet,
      contractAddress: string
    ): Promise<EdgeTokenId> => {
      if (contractAddress === '0x0000000000000000000000000000000000000000') {
        return null
      } else {
        const fakeToken: EdgeToken = {
          currencyCode: 'FAKE',
          denominations: [{ name: 'FAKE', multiplier: '1' }],
          displayName: 'FAKE',
          networkLocation: {
            contractAddress
          }
        }
        return await wallet.currencyConfig.getTokenId(fakeToken)
      }
    }

    let bridgelessToken: Token | undefined
    let pageKey: string | undefined
    while (true) {
      const pageKeyStr = pageKey == null ? '' : `?pagination.key=${pageKey}`
      const raw = await fetchBridgeless(fetch, `/tokens${pageKeyStr}`)
      const response = asBridgeTokens(raw)

      // Find a token object where both from and to infos are present
      for (const token of response.tokens) {
        let fromTokenInfo: TokenInfo | undefined
        let toTokenInfo: TokenInfo | undefined
        for (const info of token.info) {
          try {
            const tokenId = await getTokenId(request.fromWallet, info.address)
            if (
              info.chain_id ===
                EDGE_PLUGINID_CHAINID_MAP[
                  request.fromWallet.currencyInfo.pluginId
                ] &&
              tokenId === request.fromTokenId
            ) {
              fromTokenInfo = info
            }
            if (
              info.chain_id ===
                EDGE_PLUGINID_CHAINID_MAP[
                  request.toWallet.currencyInfo.pluginId
                ] &&
              tokenId === request.toTokenId
            ) {
              toTokenInfo = info
            }
          } catch (e) {
            // ignore tokens that fail validation
          }
        }
        if (fromTokenInfo != null && toTokenInfo != null) {
          bridgelessToken = token
          break
        }
      }

      if (response.pagination.next_key == null) {
        break
      }
      pageKey = response.pagination.next_key
    }
    if (bridgelessToken == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const commission = bridgelessToken.commission_rate
    if (commission == null) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    let fromAmount: string
    let toAmount: string
    if (request.quoteFor === 'to') {
      fromAmount = floor(mul(request.nativeAmount, add('1', commission)), 0)
      toAmount = request.nativeAmount
    } else {
      fromAmount = request.nativeAmount
      toAmount = floor(mul(request.nativeAmount, sub('1', commission)), 0)
    }

    // This will be provided by the /tokens endpoint in the future. For BTC/WBTC, we'lll enforce a limit of 10000 satoshis. This limit exists both ways.
    // If endpoint returns a 0 that means no limit
    const minAmount = '10000'
    const direction = request.quoteFor === 'to' ? 'to' : 'from'
    if (lt(direction === 'to' ? toAmount : fromAmount, minAmount.toString())) {
      throw new SwapBelowLimitError(swapInfo, minAmount.toString(), direction)
    }

    let receiver: string | undefined
    switch (request.toWallet.currencyInfo.pluginId) {
      case 'bitcoin': {
        receiver = toAddress
        break
      }
      case 'zano': {
        receiver = base16.encode(base58.decode(toAddress))
        break
      }
      default: {
        throw new SwapCurrencyError(swapInfo, request)
      }
    }

    // chainId/txid/outputIndex
    // output index is 0 for both Bitcoin (output of actual deposit) and Zano (index of serviceEntries with deposit instructions)
    // txid must be 0x prefixed
    const orderId = `${fromChainId}/0x{{TXID}}/0`

    const assetAction: EdgeAssetAction = {
      assetActionType: 'swap'
    }
    const savedAction: EdgeTxActionSwap = {
      actionType: 'swap',
      orderId,
      orderUri: `${ORDER_URL}/check/${orderId}`,
      swapInfo,
      isEstimate: false,
      toAsset: {
        pluginId: request.toWallet.currencyInfo.pluginId,
        tokenId: request.toTokenId,
        nativeAmount: toAmount
      },
      fromAsset: {
        pluginId: request.fromWallet.currencyInfo.pluginId,
        tokenId: request.fromTokenId,
        nativeAmount: fromAmount
      },
      payoutAddress: toAddress,
      payoutWalletId: request.toWallet.id
    }

    switch (request.fromWallet.currencyInfo.pluginId) {
      case 'bitcoin': {
        const opReturn = `${receiver}${Buffer.from(
          `#${toChainId}`,
          'utf8'
        ).toString('hex')}`

        const spendInfo: EdgeSpendInfo = {
          otherParams: {
            outputSort: 'targets',
            memoIndex: 1
          },
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount: fromAmount,
              publicAddress: bridgeAddress
            }
          ],
          memos: [{ type: 'hex', value: opReturn }],
          assetAction,
          savedAction
        }

        return {
          request,
          spendInfo,
          swapInfo,
          fromNativeAmount: fromAmount
        }
      }
      case 'zano': {
        const bodyData = {
          dst_add: toAddress,
          dst_net_id: toChainId,
          uniform_padding: '    '
        }
        const jsonString: string = JSON.stringify(bodyData)
        const bytes: Uint8Array = new TextEncoder().encode(jsonString)
        const bodyHex: string = base16.encode(bytes)

        const zanoAction = {
          assetId: request.fromTokenId,
          burnAmount: parseInt(fromAmount),
          nativeAmount: parseInt(fromAmount),
          pointTxToAddress: bridgeAddress,
          serviceEntries: [
            {
              body: bodyHex,
              flags: 0,
              instruction: 'BI',
              service_id: 'B'
            }
          ]
        }

        const encoder = new TextEncoder()
        const unsignedTx = encoder.encode(JSON.stringify(zanoAction))

        const makeTxParams: MakeTxParams = {
          type: 'MakeTx',
          unsignedTx: unsignedTx,
          metadata: {
            assetAction,
            savedAction
          }
        }

        return {
          request,
          makeTxParams,
          swapInfo,
          fromNativeAmount: fromAmount
        }
      }
      default: {
        throw new SwapCurrencyError(swapInfo, request)
      }
    }
  }

  const out: EdgeSwapPlugin = {
    swapInfo,

    async fetchSwapQuote(req: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      const request = convertRequest(req)

      const newRequest = await getMaxSwappable(fetchSwapQuoteInner, request)
      const swapOrder = await fetchSwapQuoteInner(newRequest)

      const swapPluginQuote = await makeSwapPluginQuote(swapOrder)

      // We'll save the swap result to avoid broadcasting the same transaction multiple times in case the autobot fetch fails
      let swapResult: EdgeSwapResult | undefined
      const out = {
        ...swapPluginQuote,
        async approve(_opts?: EdgeSwapApproveOptions): Promise<EdgeSwapResult> {
          if (swapResult == null) {
            swapResult = await swapPluginQuote.approve(_opts)
          }
          const { txid } = swapResult.transaction

          if (
            swapResult.transaction.savedAction?.actionType === 'swap' &&
            swapResult.transaction.savedAction.orderId != null
          ) {
            swapResult.transaction.savedAction.orderId = swapResult.transaction.savedAction.orderId.replace(
              '{{TXID}}',
              txid
            )

            const [
              chainId,
              ,
              txNonce
            ] = swapResult.transaction.savedAction.orderId.split('/')

            const res = await opts.io.fetch(`${AUTO_BOT_URL}/api/bridgeless`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ chainId, txHash: txid, txNonce })
            })
            if (!res.ok) {
              throw new Error('Failed to send txid to bridgeless submitter')
            }
          }
          return swapResult
        }
      }

      return out
    }
  }

  return out
}
