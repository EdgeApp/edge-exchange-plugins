import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin
} from 'edge-core-js/types'

import { thorchain as thorchainMapping } from '../../../mappings/thorchain'
import { mapToStringMap } from '../../../util/swapHelpers'
import {
  asInitOptions,
  ExchangeInfo,
  makeThorchainBasedPlugin
} from './thorchainCommon'

const swapInfo: EdgeSwapInfo = {
  pluginId: 'thorchain',
  isDex: true,
  displayName: 'Thorchain',
  supportEmail: 'support@edge.app'
}
const orderUri = 'https://track.ninerealms.com/{{TXID}}'

const MIDGARD_SERVERS_DEFAULT = ['https://midgard.thorchain.info']
export const THORNODE_SERVERS_DEFAULT = [
  'https://thornode.ninerealms.com/thorchain'
]

const infoServer: {
  exchangeInfo: ExchangeInfo | undefined
  exchangeInfoLastUpdate: number
} = { exchangeInfo: undefined, exchangeInfoLastUpdate: 0 }

// Network names that don't match parent network currency code
const MAINNET_CODE_TRANSCRIPTION: {
  [cc: string]: string
} = mapToStringMap(thorchainMapping)

export const makeThorchainPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  const initOptions = asInitOptions(opts.initOptions)

  const thornodesFetchOptions = {
    'Content-Type': 'application/json',
    'x-client-id': initOptions.ninerealmsClientId
  }

  return makeThorchainBasedPlugin(opts, {
    MAINNET_CODE_TRANSCRIPTION,
    MIDGARD_SERVERS_DEFAULT,
    THORNODE_SERVERS_DEFAULT,
    infoServer,
    orderUri,
    swapInfo,
    thornodesFetchOptions
  })
}
