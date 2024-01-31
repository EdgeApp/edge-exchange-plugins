import { EdgeSwapInfo } from 'edge-core-js'

import { makeSwapPlugin } from '../util/makeSwapPlugin'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'xrpdex',
  isDex: true,
  displayName: 'XRP DEX',
  supportEmail: 'support@edge.app'
}

export const xrpdex = makeSwapPlugin({
  swapInfo,

  checkEnvironment() {
    if (typeof BigInt === 'undefined') {
      throw new Error('XRP DEX requires BigInt support')
    }
  },

  getInnerPlugin: async () => await import('./defi/xrpDex')
})
