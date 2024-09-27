import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import { makeThorchainBasedPlugin } from './common'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'mayaprotocol',
  isDex: true,
  displayName: 'Maya Protocol',
  supportEmail: 'support@edge.app'
}
const orderUri = 'https://www.mayascan.org/tx/'

const MIDGARD_SERVERS_DEFAULT = ['https://midgard.mayachain.info']
const THORNODE_SERVERS_DEFAULT = ['https://mayanode.mayachain.info/mayachain']

// Network names that don't match parent network currency code
export const MAINNET_CODE_TRANSCRIPTION: { [cc: string]: string } = {
  arbitrum: 'ARB',
  bitcoin: 'BTC',
  dash: 'DASH',
  ethereum: 'ETH',
  litecoin: 'LTC',
  thorchainrune: 'THOR'
}

export const makeMayaProtocolPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  return makeThorchainBasedPlugin(opts, {
    MAINNET_CODE_TRANSCRIPTION,
    MIDGARD_SERVERS_DEFAULT,
    THORNODE_SERVERS_DEFAULT,
    orderUri,
    swapInfo
  })
}