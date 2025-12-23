import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asRangoMetaResponse } from './rangoTypes'

const NAME = 'rango'

export const makeRangoSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.RANGO_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing RANGO_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch(
        `https://api.rango.exchange/basic/meta?apiKey=${apiKey}`
      )
      if (!response.ok) {
        throw new Error(
          `Failed to fetch Rango networks: ${response.statusText}`
        )
      }
      const data = await response.json()
      const { blockchains } = asRangoMetaResponse(data)

      if (blockchains.length === 0) {
        throw new Error(
          'Rango API returned 0 blockchains. This likely indicates an API error.'
        )
      }

      return blockchains.map(chain => ({
        chainCode: chain.name,
        metadata: {
          'Display Name': chain.displayName ?? chain.name
        }
      }))
    }
  }
}
