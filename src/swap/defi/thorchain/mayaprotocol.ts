import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import { mayaprotocol as mayaprotocolMapping } from '../../../mappings/mayaprotocol'
import { mapToStringMap } from '../../../util/swapHelpers'
import { makeThorchainBasedPlugin } from './thorchainCommon'
import {
  ExchangeInfo,
  ProviderNativeChain,
  ThorchainChainStrategy
} from './thorchainTypes'
import { makeZcashShieldedMemoSpend } from './zcashShieldedMemo'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'mayaprotocol',
  isDex: true,
  displayName: 'Maya Protocol',
  supportEmail: 'support@edge.app'
}
const orderUri = 'https://www.mayascan.org/tx/{{TXID}}'

const MIDGARD_SERVERS_DEFAULT = ['https://midgard.mayachain.info']
const THORNODE_SERVERS_DEFAULT = ['https://mayanode.mayachain.info/mayachain']

const infoServer: {
  exchangeInfo: ExchangeInfo | undefined
  exchangeInfoLastUpdate: number
} = { exchangeInfo: undefined, exchangeInfoLastUpdate: 0 }

// Network names that don't match parent network currency code
export const MAINNET_CODE_TRANSCRIPTION: {
  [cc: string]: string
} = mapToStringMap(mayaprotocolMapping)

/**
 * Maya's own chain. CACAO is spent with a MsgDeposit and, having no pool of
 * its own, is priced at 1. Mayanode expresses MAYAChain's assets in their
 * native precision (CACAO 1e10, MAYA 1e4) while normalizing bridged assets
 * to 1e8, and CACAO is low value, so a max-quote probe seeds with 1000 CACAO
 * to clear Maya's minimum.
 */
export const MAYA_NATIVE_CHAIN: ProviderNativeChain = {
  pluginId: 'mayachain',
  baseAsset: 'MAYA.CACAO',
  ownAssetsUseNativePrecision: true,
  maxQuoteSeedExchangeAmount: '1000'
}

/**
 * Maya's Zcash vaults pay out to transparent addresses only, and take a
 * Zcash swap in with the memo carried in a shielded note.
 */
const MAYA_CHAINS: { [pluginId: string]: ThorchainChainStrategy } = {
  zcash: {
    destinationAddressType: 'transparentAddress',
    makeSourceSpend: makeZcashShieldedMemoSpend
  }
}

export const makeMayaProtocolPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  return makeThorchainBasedPlugin(opts, {
    MAINNET_CODE_TRANSCRIPTION,
    MIDGARD_SERVERS_DEFAULT,
    THORNODE_SERVERS_DEFAULT,
    infoServer,
    orderUri,
    swapInfo,
    nativeChain: MAYA_NATIVE_CHAIN,
    chains: MAYA_CHAINS
  })
}
