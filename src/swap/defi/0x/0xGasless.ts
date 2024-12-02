import {
  EdgeAssetAction,
  EdgeCorePluginFactory,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapQuote,
  EdgeSwapResult,
  EdgeTransaction,
  EdgeTxAction
} from 'edge-core-js/types'

import { due } from '../../../util/due'
import { snooze } from '../../../util/utils'
import { EXPIRATION_MS, NATIVE_TOKEN_ADDRESS } from './constants'
import { asInitOptions } from './types'
import { getCurrencyCode, getTokenAddress, makeSignatureStruct } from './util'
import { ZeroXApi } from './ZeroXApi'
import {
  GaslessSwapStatusResponse,
  GaslessSwapSubmitRequest
} from './zeroXApiTypes'

const swapInfo: EdgeSwapInfo = {
  displayName: '0x Gasless Swap',
  isDex: true,
  pluginId: '0xgasless',
  supportEmail: 'support@edge.app'
}

export const make0xGaslessPlugin: EdgeCorePluginFactory = opts => {
  const { io } = opts
  const initOptions = asInitOptions(opts.initOptions)

  const api = new ZeroXApi(io, initOptions.apiKey)

  return {
    swapInfo,
    fetchSwapQuote: async (swapRequest): Promise<EdgeSwapQuote> => {
      // The fromWallet and toWallet must be of the same because the swap
      // service only supports swaps of the same network and for the same
      // account/address.
      if (swapRequest.toWallet.id !== swapRequest.fromWallet.id) {
        throw new Error('Swap between different wallets is not supported')
      }

      const fromTokenAddress = getTokenAddress(
        swapRequest.fromWallet,
        swapRequest.fromTokenId
      )
      const toTokenAddress = getTokenAddress(
        swapRequest.toWallet,
        swapRequest.toTokenId
      )

      const swapNativeAmount: string = due(() => {
        if (swapRequest.quoteFor === 'max') {
          const balance = swapRequest.fromWallet.balanceMap.get(
            swapRequest.fromTokenId
          )
          if (balance == null) throw new Error('No balance for the from token')
          return balance
        } else {
          return swapRequest.nativeAmount
        }
      })

      // From wallet address
      const {
        publicAddress: fromWalletAddress
      } = await swapRequest.fromWallet.getReceiveAddress({
        tokenId: swapRequest.fromTokenId
      })

      // Amount request parameter/field name to use in the quote request
      const amountField =
        swapRequest.quoteFor === 'to' ? 'buyAmount' : 'sellAmount'

      // Get quote from ZeroXApi
      const chainId = api.getChainIdFromPluginId(
        swapRequest.fromWallet.currencyInfo.pluginId
      )
      const apiSwapQuote = await api.gaslessSwapQuote(chainId, {
        [amountField]: swapNativeAmount,
        acceptedTypes: 'metatransaction_v2',
        buyToken: toTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        checkApproval: true,
        feeRecipient: initOptions.feeReceiveAddress,
        feeSellTokenPercentage: initOptions.feePercentage,
        feeType: 'volume',
        sellToken: fromTokenAddress ?? NATIVE_TOKEN_ADDRESS,
        takerAddress: fromWalletAddress
      })

      if (!apiSwapQuote.liquidityAvailable)
        throw new Error('No liquidity available')

      // The plugin only supports gasless swaps, so if approval is required
      // it must be gasless.
      if (
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
        apiSwapQuote.approval != null &&
        apiSwapQuote.approval.isRequired &&
        !apiSwapQuote.approval.isGaslessAvailable
      ) {
        throw new Error('Approval is required but gasless is not available')
      }

      return {
        approve: async (
          opts?: EdgeSwapApproveOptions
        ): Promise<EdgeSwapResult> => {
          let approvalData: GaslessSwapSubmitRequest['approval']
          if (
            // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
            apiSwapQuote.approval != null &&
            apiSwapQuote.approval.isRequired
          ) {
            // Assert that that approval is gasless, otherwise it would have
            // been caught above, so this case should be unreachable.
            if (!apiSwapQuote.approval.isGaslessAvailable) {
              throw new Error('Unreachable non-gasless approval condition')
            }

            const approvalTypeData = JSON.stringify(
              apiSwapQuote.approval.eip712
            )
            const approvalSignatureHash = await swapRequest.fromWallet.signMessage(
              approvalTypeData,
              { otherParams: { typedData: true } }
            )
            const approvalSignature = makeSignatureStruct(approvalSignatureHash)
            approvalData = {
              type: apiSwapQuote.approval.type,
              eip712: apiSwapQuote.approval.eip712,
              signature: approvalSignature
            }
          }

          const tradeTypeData = JSON.stringify(apiSwapQuote.trade.eip712)
          const tradeSignatureHash = await swapRequest.fromWallet.signMessage(
            tradeTypeData,
            { otherParams: { typedData: true } }
          )
          const tradeSignature = makeSignatureStruct(tradeSignatureHash)
          const tradeData: GaslessSwapSubmitRequest['trade'] = {
            type: apiSwapQuote.trade.type,
            eip712: apiSwapQuote.trade.eip712,
            signature: tradeSignature
          }

          const apiSwapSubmition = await api.gaslessSwapSubmit(chainId, {
            ...(approvalData !== undefined ? { approval: approvalData } : {}),
            trade: tradeData
          })

          let apiSwapStatus: GaslessSwapStatusResponse
          do {
            // Wait before checking
            await snooze(500)
            apiSwapStatus = await api.gaslessSwapStatus(
              chainId,
              apiSwapSubmition.tradeHash
            )
          } while (apiSwapStatus.status === 'pending')

          if (apiSwapStatus.status === 'failed') {
            throw new Error(`Swap failed: ${apiSwapStatus.reason ?? 'unknown'}`)
          }

          const assetAction: EdgeAssetAction = {
            assetActionType: 'swap'
          }
          const orderId = apiSwapSubmition.tradeHash

          const savedAction: EdgeTxAction = {
            actionType: 'swap',
            canBePartial: false,
            isEstimate: false,
            fromAsset: {
              pluginId: swapRequest.fromWallet.currencyInfo.pluginId,
              tokenId: swapRequest.fromTokenId,
              nativeAmount: swapNativeAmount
            },
            orderId,
            // The payout address is the same as the fromWalletAddress because
            // the swap service only supports swaps of the same network and
            // account/address.
            payoutAddress: fromWalletAddress,
            payoutWalletId: swapRequest.toWallet.id,
            refundAddress: fromWalletAddress,
            swapInfo,
            toAsset: {
              pluginId: swapRequest.toWallet.currencyInfo.pluginId,
              tokenId: swapRequest.toTokenId,
              nativeAmount: apiSwapQuote.buyAmount
            }
          }

          // Create the minimal transaction object for the swap.
          // Some values may be updated later when the transaction is
          // updated from queries to the network.
          const fromCurrencyCode = getCurrencyCode(
            swapRequest.fromWallet,
            swapRequest.fromTokenId
          )
          const transaction: EdgeTransaction = {
            assetAction,
            blockHeight: 0,
            currencyCode: fromCurrencyCode,
            date: Date.now(),
            isSend: true,
            memos: [],
            nativeAmount: swapNativeAmount,
            // There is no fee for a gasless swap
            networkFee: '0',
            networkFees: [],
            ourReceiveAddresses: [],
            savedAction,
            signedTx: '', // Signing is done by the tx-relay server
            tokenId: swapRequest.fromTokenId,
            txid: apiSwapStatus.transactions[0].hash,
            walletId: swapRequest.fromWallet.id
          }

          // Don't forget to save the transaction to the wallet:
          await swapRequest.fromWallet.saveTx(transaction)

          return {
            orderId,
            transaction
          }
        },
        close: async () => {},
        expirationDate: new Date(Date.now() + EXPIRATION_MS),
        fromNativeAmount: apiSwapQuote.sellAmount,
        isEstimate: false,
        networkFee: {
          currencyCode: swapRequest.fromWallet.currencyInfo.currencyCode,
          nativeAmount: '0', // There is no fee for a gasless swap
          tokenId: null
        },
        pluginId: swapInfo.pluginId,
        request: swapRequest,
        swapInfo: swapInfo,
        toNativeAmount: apiSwapQuote.buyAmount
      }
    }
  }
}
