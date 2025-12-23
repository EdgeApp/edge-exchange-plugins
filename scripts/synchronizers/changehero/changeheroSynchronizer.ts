import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asChangeheroResponse } from './changeheroTypes'

const NAME = 'changehero'

export const makeChangeHeroSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.CHANGEHERO_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing CHANGEHERO_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://api.changehero.io/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'one',
          method: 'getCurrenciesFull',
          params: {}
        })
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ChangeHero networks: ${response.statusText}`
        )
      }

      const data = await response.json()
      const { result } = asChangeheroResponse(data)

      if (result.length === 0) {
        throw new Error(
          'ChangeHero API returned 0 currencies. This likely indicates an API error.'
        )
      }

      // Extract unique blockchain values with metadata
      const blockchainMap = new Map<string, { name: string; count: number }>()
      result.forEach(currency => {
        if (currency.blockchain != null && currency.blockchain !== '') {
          const existing = blockchainMap.get(currency.blockchain)
          if (existing != null) {
            existing.count++
          } else {
            blockchainMap.set(currency.blockchain, {
              name: currency.blockchain,
              count: 1
            })
          }
        }
      })

      const results = Array.from(blockchainMap.entries()).map(
        ([blockchain, info]) => ({
          chainCode: blockchain,
          metadata: {
            'Display Name': info.name,
            'Currency Count': String(info.count)
          }
        })
      )

      if (results.length === 0) {
        throw new Error(
          'ChangeHero API returned currencies but no valid blockchains were extracted.'
        )
      }

      return results
    }
  }
}
