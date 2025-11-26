import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asGodexCoinsResponse } from './godexTypes'

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/godexMappings.ts'
)

export const makeGodexSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: 'godex',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { godex } = require('../../mappings/godexMappings')
        return godex
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const networkMap = new Map<string, { name: string }>()

      // Get list of all coins - the response includes networks array for each coin
      const coinsResponse = await fetch('https://api.godex.io/api/v1/coins', {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })

      if (!coinsResponse.ok) {
        throw new Error(
          `Failed to fetch Godex coins: ${coinsResponse.statusText}`
        )
      }

      const coinsData = await coinsResponse.json()
      const coins = asGodexCoinsResponse(coinsData)

      if (coins.length === 0) {
        throw new Error(
          'Godex API returned 0 coins. This likely indicates an API error.'
        )
      }

      // Extract unique network codes from all coins
      coins.forEach(coin => {
        if (coin.networks != null && coin.networks.length > 0) {
          coin.networks.forEach(network => {
            // Only include active networks (is_active === 1)
            if (
              network.is_active === 1 &&
              network.code != null &&
              network.code !== ''
            ) {
              if (!networkMap.has(network.code)) {
                networkMap.set(network.code, {
                  name: network.name
                })
              }
            }
          })
        }
      })

      if (networkMap.size === 0) {
        throw new Error(
          'Godex API returned coins but no valid networks were extracted.'
        )
      }

      return Array.from(networkMap.entries()).map(([networkId, info]) => ({
        chainCode: networkId,
        metadata: {
          'Display Name': info.name
        }
      }))
    }
  }
}
