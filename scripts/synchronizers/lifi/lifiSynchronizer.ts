import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asLifiChainsResponse } from './lifiTypes'

const MAPPING_FILE_PATH = path.join(__dirname, '../../mappings/lifiMappings.ts')

export const makeLifiSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: 'lifi',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { lifi } = require('../../mappings/lifiMappings')
        return lifi
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://li.quest/v1/chains')
      if (!response.ok) {
        throw new Error(`Failed to fetch LiFi networks: ${response.statusText}`)
      }
      const data = await response.json()
      const { chains } = asLifiChainsResponse(data)

      if (chains.length === 0) {
        throw new Error(
          'LiFi API returned 0 chains. This likely indicates an API error.'
        )
      }

      return chains.map(chain => ({
        chainCode: chain.key,
        metadata: {
          'Display Name': chain.name
        }
      }))
    }
  }
}
