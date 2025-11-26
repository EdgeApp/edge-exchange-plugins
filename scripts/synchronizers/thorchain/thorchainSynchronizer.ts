import fs from 'fs'
import fetch, { Response } from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asThorchainPoolsResponse } from './thorchainTypes'

// Fallback Midgard servers (try multiple endpoints)
const MIDGARD_SERVERS = [
  'https://midgard.ninerealms.com',
  'https://midgard.thorchain.info'
]

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/thorchainMappings.ts'
)

async function fetchWithFallback(
  servers: string[],
  urlPath: string
): Promise<Response> {
  let lastError: Error | undefined

  for (const server of servers) {
    try {
      const url = `${server}/${urlPath}`
      const response = await fetch(url)

      if (response.ok) {
        return response
      }

      lastError = new Error(
        `Failed to fetch from ${url}: ${response.statusText}`
      )
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error))
      // Continue to next server
    }
  }

  throw new Error(
    `Failed to fetch THORChain pools from all servers: ${
      lastError?.message ?? 'Unknown error'
    }`
  )
}

export const makeThorchainSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: 'thorchain',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { thorchain } = require('../../mappings/thorchainMappings')
        return thorchain
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetchWithFallback(MIDGARD_SERVERS, 'v2/pools')

      const data = await response.json()
      const pools = asThorchainPoolsResponse(data)

      if (pools.length === 0) {
        throw new Error(
          'THORChain API returned 0 pools. This likely indicates an API error.'
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
          'THORChain API returned pools but no valid chains were extracted.'
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
