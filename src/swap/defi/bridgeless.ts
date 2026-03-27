import { base16, base58 } from '@scure/base'
import { add, ceil, lt, mul, sub } from 'biggystring'
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
import { ethers } from 'ethers'

import {
  getMaxSwappable,
  makeSwapPluginQuote,
  SwapOrder
} from '../../util/swapHelpers'
import { convertRequest, getAddress } from '../../util/utils'
import { EdgeSwapRequestPlugin, MakeTxParams } from '../types'
import { createEvmApprovalEdgeTransactions } from './defiUtils'

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
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const EDGE_PLUGINID_CHAINID_MAP: Record<string, string> = {
  // base: '8453', // only support btc for now
  binancesmartchain: '56',
  bitcoin: '0',
  bitcoincash: '5',
  ethereum: '1',
  zano: '2'
}

const asTokenInfo = asObject({
  address: asString,
  decimals: asString,
  chain_id: asString,
  token_id: asString,
  commission_rate: asString,
  min_withdrawal_amount: asString,
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
  info: asArray(asTokenInfo)
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

export const scaleNativeAmount = (
  amount: string,
  fromDecimals: number,
  toDecimals: number,
  round: 'down' | 'up'
): string => {
  const diff = toDecimals - fromDecimals
  if (diff === 0) return amount

  if (diff > 0) {
    return amount + '0'.repeat(diff)
  }

  const places = -diff
  if (amount.length <= places) {
    return round === 'up' && /[1-9]/.test(amount) ? '1' : '0'
  }

  const whole = amount.slice(0, -places)
  const remainder = amount.slice(-places)

  if (round === 'up' && /[1-9]/.test(remainder)) {
    return add(whole, '1')
  }

  return whole
}

const BRIDGELESS_EVM_ABI = [
  'function depositERC20(address token_, uint256 amount_, string receiver_, string network_, bool isWrapped_, uint16 referralId_)',
  'function depositNative(string receiver_, string network_, uint16 referralId_) payable'
]

interface BridgelessTokenInfo {
  address: string
  is_wrapped: boolean
}

interface MakeBridgelessEvmSpendInfoParams {
  fromAmount: string
  fromTokenInfo: BridgelessTokenInfo
  toChainId: string
  receiver: string
}

const makeBridgelessEvmSpendInfo = ({
  fromAmount,
  fromTokenInfo,
  toChainId,
  receiver
}: MakeBridgelessEvmSpendInfoParams): string => {
  const iface = new ethers.utils.Interface(BRIDGELESS_EVM_ABI)
  const tokenAddress = ethers.utils.getAddress(fromTokenInfo.address)
  const isNativeToken = tokenAddress.toLowerCase() === ZERO_ADDRESS

  return isNativeToken
    ? iface.encodeFunctionData('depositNative', [receiver, toChainId, 0])
    : iface.encodeFunctionData('depositERC20', [
        tokenAddress,
        fromAmount,
        receiver,
        toChainId,
        fromTokenInfo.is_wrapped,
        0
      ])
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
    if (
      fromChainId == null ||
      toChainId == null ||
      fromChainId === toChainId ||
      (fromChainId !== '2' && toChainId !== '2') // Only use this plugin for swaps that involve the Zano blockchain
    ) {
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
      if (contractAddress === ZERO_ADDRESS) {
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
    let fromTokenInfo: TokenInfo | undefined
    let toTokenInfo: TokenInfo | undefined
    while (true) {
      const pageKeyStr = pageKey == null ? '' : `?pagination.key=${pageKey}`
      const raw = await fetchBridgeless(opts.io.fetch, `/tokens${pageKeyStr}`)
      const response = asBridgeTokens(raw)

      // Find a token object where both from and to infos are present
      for (const token of response.tokens) {
        let fromTokenInfoForToken: TokenInfo | undefined
        let toTokenInfoForToken: TokenInfo | undefined
        for (const info of token.info) {
          try {
            if (fromTokenInfoForToken == null) {
              const tokenId = await getTokenId(request.fromWallet, info.address)
              if (
                info.chain_id ===
                  EDGE_PLUGINID_CHAINID_MAP[
                    request.fromWallet.currencyInfo.pluginId
                  ] &&
                tokenId === request.fromTokenId
              ) {
                fromTokenInfoForToken = info
              }
            }
          } catch (e) {
            // ignore tokens that fail validation
          }
          try {
            if (toTokenInfoForToken == null) {
              const tokenId = await getTokenId(request.toWallet, info.address)
              if (
                info.chain_id ===
                  EDGE_PLUGINID_CHAINID_MAP[
                    request.toWallet.currencyInfo.pluginId
                  ] &&
                tokenId === request.toTokenId
              ) {
                toTokenInfoForToken = info
              }
            }
          } catch (e) {
            // ignore tokens that fail validation
          }
        }
        if (fromTokenInfoForToken != null && toTokenInfoForToken != null) {
          fromTokenInfo = fromTokenInfoForToken
          toTokenInfo = toTokenInfoForToken
          bridgelessToken = token
          break
        }
      }

      if (response.pagination.next_key == null) {
        break
      }
      pageKey = response.pagination.next_key
    }
    if (
      bridgelessToken == null ||
      fromTokenInfo == null ||
      toTokenInfo == null
    ) {
      throw new SwapCurrencyError(swapInfo, request)
    }

    const fromDecimals = parseInt(fromTokenInfo.decimals, 10)
    const toDecimals = parseInt(toTokenInfo.decimals, 10)

    // The minimum amount is enforced by the amount of toToken received
    let fromAmount: string
    let toAmount: string
    if (request.quoteFor === 'to') {
      toAmount = request.nativeAmount

      if (lt(toAmount, toTokenInfo.min_withdrawal_amount)) {
        throw new SwapBelowLimitError(
          swapInfo,
          toTokenInfo.min_withdrawal_amount,
          'to'
        )
      }

      const grossToAmount = ceil(
        mul(toAmount, add('1', toTokenInfo.commission_rate)),
        0
      )
      fromAmount = scaleNativeAmount(
        grossToAmount,
        toDecimals,
        fromDecimals,
        'up'
      )
    } else {
      fromAmount = request.nativeAmount
      const bridgedToAmount = scaleNativeAmount(
        fromAmount,
        fromDecimals,
        toDecimals,
        'down'
      )
      toAmount = ceil(
        mul(bridgedToAmount, sub('1', toTokenInfo.commission_rate)),
        0
      )

      const minGrossToAmount = ceil(
        mul(
          toTokenInfo.min_withdrawal_amount,
          add('1', toTokenInfo.commission_rate)
        ),
        0
      )
      const minFromAmount = scaleNativeAmount(
        minGrossToAmount,
        toDecimals,
        fromDecimals,
        'up'
      )
      if (lt(toAmount, toTokenInfo.min_withdrawal_amount)) {
        throw new SwapBelowLimitError(swapInfo, minFromAmount, 'from')
      }
    }

    const receiver =
      request.toWallet.currencyInfo.pluginId === 'zano'
        ? base16.encode(base58.decode(toAddress))
        : toAddress

    // chainId/txid/outputIndex
    // output index is 0 for both Bitcoin (output of actual deposit) and Zano (index of serviceEntries with deposit instructions)
    // txid must be 0x prefixed
    const orderId = `${fromChainId}/{{TXID}}/0`

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
      case 'bitcoin':
      case 'bitcoincash': {
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
      case 'binancesmartchain':
      case 'ethereum': {
        const data = makeBridgelessEvmSpendInfo({
          fromAmount,
          fromTokenInfo,
          toChainId,
          receiver: toAddress
        })
        const isNativeToken =
          request.fromTokenId == null ||
          fromTokenInfo.address.toLowerCase() === ZERO_ADDRESS
        const preTxs = isNativeToken
          ? []
          : await createEvmApprovalEdgeTransactions({
              request,
              approvalAmount: fromAmount,
              tokenContractAddress: fromTokenInfo.address,
              recipientAddress: bridgeAddress
            })

        // For tokens, the nonce is the second log emitted from the transaction.
        if (!isNativeToken) {
          const orderId = `${fromChainId}/{{TXID}}/1`
          savedAction.orderId = orderId
          savedAction.orderUri = `${ORDER_URL}/check/${orderId}`
        }
        const spendInfo: EdgeSpendInfo = {
          tokenId: request.fromTokenId,
          spendTargets: [
            {
              nativeAmount: fromAmount,
              publicAddress: bridgeAddress
            }
          ],
          memos: [{ type: 'hex', value: data.replace(/^0x/, '') }],
          assetAction,
          savedAction
        }

        return {
          request,
          spendInfo,
          preTxs,
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

          const savedAction = swapResult.transaction.savedAction
          const assetAction = swapResult.transaction.assetAction

          if (
            savedAction != null &&
            savedAction.actionType === 'swap' &&
            savedAction.orderId != null
          ) {
            const txHash = txid.startsWith('0x') ? txid : `0x${txid}`
            savedAction.orderId = savedAction.orderId.replace(
              '{{TXID}}',
              txHash
            )
            // Refresh orderUri to include the resolved txid
            if (savedAction.orderId != null) {
              savedAction.orderUri = `${ORDER_URL}/check/${savedAction.orderId}`
            }

            const [chainId, , txNonce] = savedAction.orderId.split('/')

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

            // Persist the updated orderId/orderUri so post-login views see the 0x-prefixed txid:
            await newRequest.fromWallet.saveTxAction({
              txid: swapResult.transaction.txid,
              tokenId: swapResult.transaction.tokenId ?? newRequest.fromTokenId,
              assetAction: assetAction ?? {
                assetActionType: 'swap'
              },
              savedAction
            })
          }
          return swapResult
        }
      }

      return out
    }
  }

  return out
}
