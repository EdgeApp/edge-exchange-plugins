import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asChangeNowCurrenciesResponse } from './changenowTypes'

const NAME = 'changenow'

export const makeChangeNowSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.CHANGENOW_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing CHANGENOW_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
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
