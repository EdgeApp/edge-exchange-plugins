import { asMaybe } from 'cleaners'
import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asXgramCurrency } from './xgramTypes'

const NAME = 'xgram'
export const makeXgramSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.XGRAM_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing XGRAM_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch(
        'https://xgram.io/api/v1/list-currency-options',
        {
          headers: {
            'x-api-key': apiKey
          }
        }
      )

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Xgram currencies: ${response.statusText}`
        )
      }

      const data = await response.json()
      if (typeof data !== 'object' || data == null) {
        throw new Error('Xgram API returned unexpected response format')
      }

      // Note: The `network` field from list-currency-options does not map
      // cleanly to the v2 quote endpoint's accepted fromNetwork/toNetwork
      // values. We still collect it here for visibility in sync output, but
      // the checked-in Xgram mappings remain hand-maintained.
      const networkMap = new Map<string, { count: number }>()
      for (const [, value] of Object.entries(data)) {
        const currency = asMaybe(asXgramCurrency)(value)
        if (currency == null) continue
        if (currency.network === '' || !currency.available) continue

        const existing = networkMap.get(currency.network)
        if (existing != null) {
          existing.count++
        } else {
          networkMap.set(currency.network, { count: 1 })
        }
      }

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
          'Xgram API returned currencies but no valid networks were extracted.'
        )
      }

      return results
    }
  }
}
