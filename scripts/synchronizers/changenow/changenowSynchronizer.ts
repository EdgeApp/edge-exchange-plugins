import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { asChangeNowCurrenciesResponse } from './changenowTypes'

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/changenowMappings.ts'
)

export const makeChangeNowSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.CHANGENOW_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing CHANGENOW_API_KEY in environment variables')
  }

  return {
    name: 'changenow',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { changenow } = require('../../mappings/changenowMappings')
        return changenow
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch(
        'https://api.changenow.io/v2/exchange/currencies?isFiat=false',
        {
          headers: {
            'x-changenow-api-key': apiKey
          }
        }
      )

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ChangeNow networks: ${response.statusText}`
        )
      }

      const data = await response.json()
      const currencies = asChangeNowCurrenciesResponse(data)

      if (currencies.length === 0) {
        throw new Error(
          'ChangeNow API returned 0 currencies. This likely indicates an API error.'
        )
      }

      // Extract unique network values with metadata
      const networkMap = new Map<string, { count: number }>()
      currencies.forEach(currency => {
        if (currency.network != null && currency.network !== '') {
          const existing = networkMap.get(currency.network)
          if (existing != null) {
            existing.count++
          } else {
            networkMap.set(currency.network, { count: 1 })
          }
        }
      })

      const results = Array.from(networkMap.entries()).map(
        ([network, info]) => ({
          chainCode: network,
          metadata: {
            'Display Name': network,
            'Currency Count': String(info.count)
          }
        })
      )

      if (results.length === 0) {
        throw new Error(
          'ChangeNow API returned currencies but no valid networks were extracted.'
        )
      }

      return results
    }
  }
}
