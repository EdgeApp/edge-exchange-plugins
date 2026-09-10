import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'
import { EdgeSwapInfo } from 'edge-core-js/types'

import { InvalidTokenIds } from '../../../util/swapHelpers'
import { StringMap } from '../../types'

export const asAssetSpread = asObject({
  sourcePluginId: asOptional(asString),
  sourceTokenId: asOptional(asString),
  sourceCurrencyCode: asOptional(asString),
  destPluginId: asOptional(asString),
  destTokenId: asOptional(asString),
  destCurrencyCode: asOptional(asString),
  volatilitySpread: asNumber
})
export type AssetSpread = ReturnType<typeof asAssetSpread>

export const asExchangeInfo = asObject({
  perAssetSpread: asArray(asAssetSpread),
  perAssetSpreadStreaming: asOptional(asArray(asAssetSpread)),
  volatilitySpread: asNumber,
  volatilitySpreadStreaming: asOptional(asNumber),
  likeKindVolatilitySpread: asNumber,
  likeKindVolatilitySpreadStreaming: asOptional(asNumber),
  midgardServers: asArray(asString),
  affiliateFeeBasis: asOptional(asString),
  streamingInterval: asOptional(asNumber),
  streamingQuantity: asOptional(asNumber),
  thornodeServersWithPath: asOptional(asArray(asString))
})
export type ExchangeInfo = ReturnType<typeof asExchangeInfo>

/**
 * The provider's own protocol chain: the one chain whose assets are spent
 * with a MsgDeposit instead of a send to an inbound vault, and whose base
 * asset prices every pool.
 */
export interface ProviderNativeChain {
  /** Edge currency pluginId of the chain (`thorchainrune`, `mayachain`). */
  pluginId: string
  /**
   * Provider notation for the base asset (`THOR.RUNE`, `MAYA.CACAO`). It is
   * the only asset the pool list omits, so it gets a synthetic pool priced at
   * 1. Another protocol's base asset is an ordinary bridged asset with a real
   * pool.
   */
  baseAsset: string
  /**
   * Whether the node's quote API expresses assets on this chain in their own
   * precision instead of the 1e8 it uses for every bridged asset. Mayanode
   * does (CACAO 1e10, MAYA 1e4); thornode normalizes everything to 1e8.
   */
  ownAssetsUseNativePrecision: boolean
  /**
   * Denominated amount of the base asset used to probe the rate for a `max`
   * quote before `getMaxTx` sizes the real one. Must clear the provider's
   * minimum: 10 RUNE on THORChain, about 1000 CACAO on Maya.
   */
  maxQuoteSeedExchangeAmount: string
}

/** Per-chain behaviour, keyed by Edge currency pluginId. */
export interface ThorchainChainStrategy {
  /**
   * `EdgeAddress.addressType` to request when this chain is the destination.
   * Used both as the quote's `destination` and as `savedAction.payoutAddress`.
   * Default: the wallet's segwit address, else its first address.
   */
  destinationAddressType?: string
}

export interface ThorchainProviderOpts {
  MAINNET_CODE_TRANSCRIPTION: StringMap
  MIDGARD_SERVERS_DEFAULT: string[]
  THORNODE_SERVERS_DEFAULT: string[]
  infoServer: {
    exchangeInfo: ExchangeInfo | undefined
    exchangeInfoLastUpdate: number
  }
  orderUri: string
  swapInfo: EdgeSwapInfo
  thornodesFetchOptions?: Record<string, string>
  nativeChain: ProviderNativeChain
  /**
   * Assets this provider cannot swap, merged over the shared
   * `INVALID_TOKEN_IDS`. For a pluginId listed in both, the provider's entry
   * wins.
   */
  invalidTokenIds?: InvalidTokenIds
  chains?: { [pluginId: string]: ThorchainChainStrategy | undefined }
}
