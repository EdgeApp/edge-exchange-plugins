import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import { makeThorchainBasedPlugin } from './common'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'thorchain',
  isDex: true,
  displayName: 'Thorchain',
  supportEmail: 'support@edge.app'
}
const orderUri = 'https://track.ninerealms.com/'

export const makeThorchainPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  return makeThorchainBasedPlugin(opts, {
    orderUri,
    swapInfo
  })
}
