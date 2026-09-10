import { asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import { thorchain as thorchainMapping } from '../../../mappings/thorchain'
import { mapToStringMap } from '../../../util/swapHelpers'
import { makeThorchainBasedPlugin } from './thorchainCommon'
import {
  ExchangeInfo,
  ProviderNativeChain,
  ThorchainChainStrategy
} from './thorchainTypes'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'thorchain',
  isDex: true,
  displayName: 'Thorchain',
  supportEmail: 'support@edge.app'
}
const orderUri = 'https://track.thorchain.org/{{TXID}}'

const MIDGARD_SERVERS_DEFAULT = ['https://midgard.thorchain.info']
export const THORNODE_SERVERS_DEFAULT = [
  'https://gateway.liquify.com/chain/thorchain_api/thorchain'
]

const infoServer: {
  exchangeInfo: ExchangeInfo | undefined
  exchangeInfoLastUpdate: number
} = { exchangeInfo: undefined, exchangeInfoLastUpdate: 0 }

// Network names that don't match parent network currency code
const MAINNET_CODE_TRANSCRIPTION: {
  [cc: string]: string
} = mapToStringMap(thorchainMapping)

/** Only THORChain's thornode gateway wants a client id header. */
const asThorchainInitOptions = asObject({
  ninerealmsClientId: asOptional(asString, '')
})

/**
 * THORChain's own chain. RUNE is spent with a MsgDeposit and, having no pool
 * of its own, is priced at 1. Thornode quotes every asset in 1e8, its own
 * included, and 10 RUNE clears its minimum for a max-quote probe.
 */
export const THORCHAIN_NATIVE_CHAIN: ProviderNativeChain = {
  pluginId: 'thorchainrune',
  baseAsset: 'THOR.RUNE',
  ownAssetsUseNativePrecision: false,
  maxQuoteSeedExchangeAmount: '10'
}

/** THORChain's Zcash vaults pay out to transparent addresses only. */
const THORCHAIN_CHAINS: { [pluginId: string]: ThorchainChainStrategy } = {
  zcash: { destinationAddressType: 'transparentAddress' }
}

export const makeThorchainPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  const { ninerealmsClientId } = asThorchainInitOptions(opts.initOptions)

  const thornodesFetchOptions = {
    'Content-Type': 'application/json',
    'x-client-id': ninerealmsClientId
  }

  return makeThorchainBasedPlugin(opts, {
    MAINNET_CODE_TRANSCRIPTION,
    MIDGARD_SERVERS_DEFAULT,
    THORNODE_SERVERS_DEFAULT,
    infoServer,
    orderUri,
    swapInfo,
    thornodesFetchOptions,
    nativeChain: THORCHAIN_NATIVE_CHAIN,
    chains: THORCHAIN_CHAINS
  })
}
