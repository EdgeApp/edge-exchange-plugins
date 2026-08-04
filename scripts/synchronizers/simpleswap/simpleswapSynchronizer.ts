import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asSimpleSwapCurrenciesResponse } from './simpleswapTypes'

const NAME = 'simpleswap'

export const makeSimpleSwapSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.SIMPLESWAP_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing SIMPLESWAP_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://api.simpleswap.io/v3/currencies', {
        headers: {
          'x-api-key': apiKey
        }
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch SimpleSwap currencies: ${response.statusText}`
        )
      }

      const data = await response.json()
      const { result: currencies } = asSimpleSwapCurrenciesResponse(data)

      if (currencies.length === 0) {
        throw new Error(
          'SimpleSwap API returned 0 currencies. This likely indicates an API error.'
        )
      }

      // Extract unique network values with metadata
      const networkMap = new Map<string, { count: number }>()
      currencies.forEach(currency => {
        if (currency.network !== '') {
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
          'SimpleSwap API returned currencies but no valid networks were extracted.'
        )
      }

      return results
    }
  }
}
