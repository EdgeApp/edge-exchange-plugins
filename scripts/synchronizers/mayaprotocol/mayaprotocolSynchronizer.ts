import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asMayaProtocolPoolsResponse } from './mayaprotocolTypes'

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/mayaprotocolMappings.ts'
)

export const makeMayaProtocolSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: 'mayaprotocol',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { mayaprotocol } = require('../../mappings/mayaprotocolMappings')
        return mayaprotocol
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://midgard.mayachain.info/v2/pools')

      if (!response.ok) {
        throw new Error(
          `Failed to fetch MayaProtocol networks: ${response.statusText}`
        )
      }

      const data = await response.json()
      const pools = asMayaProtocolPoolsResponse(data)

      if (pools.length === 0) {
        throw new Error(
          'MayaProtocol API returned 0 pools. This likely indicates an API error.'
        )
      }

      // Extract unique chain identifiers from pool assets
      // Format: "CHAIN.SYMBOL-CONTRACT" (e.g., "ETH.USDT-0x...")
      const uniqueChains = new Set<string>()
      pools.forEach(pool => {
        if (pool.asset != null && pool.asset !== '') {
          // Extract chain from asset string (format: "CHAIN.SYMBOL-...")
          const parts = pool.asset.split('.')
          if (parts.length > 0 && parts[0] != null && parts[0] !== '') {
            uniqueChains.add(parts[0])
          }
        }
      })

      if (uniqueChains.size === 0) {
        throw new Error(
          'MayaProtocol API returned pools but no valid chains were extracted.'
        )
      }

      return Array.from(uniqueChains).map(chain => ({
        chainCode: chain,
        metadata: {
          'Display Name': chain
        }
      }))
    }
  }
}
