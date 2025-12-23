import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asSideShiftAsset, asSideShiftAssetsResponse } from './sideshiftTypes'

const NAME = 'sideshift'

export const makeSideShiftSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://sideshift.ai/api/v2/coins')

      if (!response.ok) {
        throw new Error(
          `Failed to fetch SideShift networks: ${response.statusText}`
        )
      }

      const data = await response.json()
      const assets = asSideShiftAssetsResponse(data)

      if (assets.length === 0) {
        throw new Error(
          'SideShift API returned 0 assets. This likely indicates an API error.'
        )
      }

      // Extract unique network values from all assets
      const uniqueNetworks = new Set<string>()
      assets.forEach(asset => {
        const parsedAsset = asSideShiftAsset(asset)
        if (parsedAsset != null) {
          parsedAsset.networks.forEach(network => {
            if (network != null && network !== '') {
              uniqueNetworks.add(network)
            }
          })
        }
      })

      if (uniqueNetworks.size === 0) {
        throw new Error(
          'SideShift API returned assets but no valid networks were extracted.'
        )
      }

      return Array.from(uniqueNetworks).map(network => ({
        chainCode: network,
        metadata: {
          'Display Name': network
        }
      }))
    }
  }
}
