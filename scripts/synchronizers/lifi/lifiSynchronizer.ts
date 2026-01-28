import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asLifiChainsResponse } from './lifiTypes'

const NAME = 'lifi'

export const makeLifiSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
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
