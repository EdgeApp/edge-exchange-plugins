import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asLetsExchangeCurrenciesResponse } from './letsexchangeTypes'

const NAME = 'letsexchange'

export const makeLetsExchangeSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.LETSEXCHANGE_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing LETSEXCHANGE_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://api.letsexchange.io/api/v2/coins', {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch LetsExchange networks: ${response.statusText}`
        )
      }

      const data = await response.json()
      const currencies = asLetsExchangeCurrenciesResponse(data)

      if (currencies.length === 0) {
        throw new Error(
          'LetsExchange API returned 0 currencies. This likely indicates an API error.'
        )
      }

      // Extract unique network codes from all currencies
      const networkSet = new Set<string>()
      currencies.forEach(currency => {
        currency.networks.forEach(network => {
          if (network.code != null && network.code !== '') {
            networkSet.add(network.code)
          }
        })
      })

      if (networkSet.size === 0) {
        throw new Error(
          'LetsExchange API returned currencies but no valid networks were extracted.'
        )
      }

      return Array.from(networkSet).map(network => ({
        chainCode: network,
        metadata: {
          'Display Name': network
        }
      }))
    }
  }
}
