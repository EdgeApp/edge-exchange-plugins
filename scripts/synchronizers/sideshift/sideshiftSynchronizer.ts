import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asSideShiftAsset, asSideShiftAssetsResponse } from './sideshiftTypes'

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/sideshiftMappings.ts'
)

export const makeSideShiftSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: 'sideshift',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { sideshift } = require('../../mappings/sideshiftMappings')
        return sideshift
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
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
