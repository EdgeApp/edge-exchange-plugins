import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asRangoMetaResponse } from './rangoTypes'

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/rangoMappings.ts'
)

export const makeRangoSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.RANGO_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing RANGO_API_KEY in environment variables')
  }

  return {
    name: 'rango',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { rango } = require('../../mappings/rangoMappings')
        return rango
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
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
