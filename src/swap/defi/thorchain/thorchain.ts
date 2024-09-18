import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import { asInitOptions, makeThorchainBasedPlugin } from './common'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'thorchain',
  isDex: true,
  displayName: 'Thorchain',
  supportEmail: 'support@edge.app'
}
const orderUri = 'https://track.ninerealms.com/'

const MIDGARD_SERVERS_DEFAULT = ['https://midgard.thorchain.info']
export const THORNODE_SERVERS_DEFAULT = [
  'https://thornode.ninerealms.com/thorchain'
]

export const makeThorchainPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  const initOptions = asInitOptions(opts.initOptions)

  const thornodesFetchOptions = {
    'Content-Type': 'application/json',
    'x-client-id': initOptions.ninerealmsClientId
  }

  return makeThorchainBasedPlugin(opts, {
    MIDGARD_SERVERS_DEFAULT,
    THORNODE_SERVERS_DEFAULT,
    orderUri,
    swapInfo,
    thornodesFetchOptions
  })
}
