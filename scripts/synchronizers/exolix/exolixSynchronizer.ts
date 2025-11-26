import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asExolixNetworksResponse } from './exolixTypes'

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/exolixMappings.ts'
)

export const makeExolixSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.EXOLIX_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing EXOLIX_API_KEY in environment variables')
  }

  return {
    name: 'exolix',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { exolix } = require('../../mappings/exolixMappings')
        return exolix
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const networkMap = new Map<
        string,
        { name: string; shortName: string | null; notes: string | null }
      >()
      let page = 1
      const pageSize = 100
      let totalFetched = 0

      // Paginate through all pages using the networks endpoint
      while (true) {
        const response = await fetch(
          `https://exolix.com/api/v2/currencies/networks?size=${pageSize}&page=${page}`,
          {
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: apiKey
            }
          }
        )

        if (!response.ok) {
          throw new Error(
            `Failed to fetch Exolix networks: ${response.statusText}`
          )
        }

        const data = await response.json()
        const { data: networks, count: totalCount } = asExolixNetworksResponse(
          data
        )

        // If we get an empty page before reaching expected count, API has an issue
        if (networks.length === 0 && totalFetched < totalCount) {
          throw new Error(
            `Exolix API returned empty page ${page} but only fetched ${totalFetched}/${totalCount} networks`
          )
        }

        networks.forEach(network => {
          if (network.network != null && network.network !== '') {
            if (!networkMap.has(network.network)) {
              networkMap.set(network.network, {
                name: network.name,
                shortName: network.shortName,
                notes: network.notes
              })
            }
          }
        })

        totalFetched += networks.length

        // Done when we've fetched all items according to the count
        if (totalFetched >= totalCount) {
          break
        }

        page++
      }

      if (networkMap.size === 0) {
        throw new Error(
          'Exolix API returned 0 networks after pagination. This likely indicates an API error.'
        )
      }

      return Array.from(networkMap.entries()).map(([networkId, info]) => {
        const metadata: Record<string, string> = {
          'Display Name': info.name
        }
        if (info.shortName != null && info.shortName !== '') {
          metadata['Short Name'] = info.shortName
        }
        if (info.notes != null && info.notes !== '') {
          metadata.Notes = info.notes
        }

        return {
          chainCode: networkId,
          metadata
        }
      })
    }
  }
}
