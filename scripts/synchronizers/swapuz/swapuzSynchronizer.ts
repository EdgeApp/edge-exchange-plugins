import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asSwapuzResponse } from './swapuzTypes'

const NAME = 'swapuz'

export const makeSwapuzSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.SWAPUZ_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing SWAPUZ_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://api.swapuz.com/api/home/v1/coins', {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Swapuz networks: ${response.status} ${response.statusText}`
        )
      }

      const json = await response.json()
      const data = asSwapuzResponse(json)

      if (data.result.length === 0) {
        throw new Error(
          'Swapuz API returned 0 coins. This likely indicates an API error.'
        )
      }

      const networks = new Set<string>()
      const networkNames = new Map<string, string>()

      // Extract networks from all coins
      for (const coin of data.result) {
        for (const network of coin.network) {
          // Use shortName as the network ID (e.g., "BSC", "ETH", "SOL")
          const networkId = network.shortName
          if (networkId !== '' && networkId != null) {
            networks.add(networkId)
            // Use fullName if available, otherwise name, otherwise shortName
            const displayName = network.fullName ?? network.name ?? networkId
            const existingName = networkNames.get(networkId)
            const existingLength = existingName?.length ?? 0
            if (
              !networkNames.has(networkId) ||
              displayName.length > existingLength
            ) {
              networkNames.set(networkId, displayName)
            }
          }
        }
      }

      if (networks.size === 0) {
        throw new Error(
          'Swapuz API returned coins but no valid networks were extracted.'
        )
      }

      return Array.from(networks).map(id => {
        const name = networkNames.get(id)
        const displayName = name != null && name !== '' ? name : id
        return {
          chainCode: id,
          metadata: {
            'Display Name': displayName
          }
        }
      })
    }
  }
}
