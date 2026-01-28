import { asJSON } from 'cleaners'
import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asSwapKitResponse, asSwapKitTokensResponse } from './swapkitTypes'

// Based on SwapKit API docs: https://docs.swapkit.dev/swapkit-api/tokens-request-supported-tokens-by-a-swap-provider

const NAME = 'swapkit'

export const makeSwapKitSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  const apiKey = config.SWAPKIT_API_KEY
  if (apiKey == null || apiKey === '') {
    throw new Error('Missing SWAPKIT_API_KEY in environment variables')
  }

  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      // First, get list of providers to know which ones to query
      const providersResponse = await fetch(
        'https://api.swapkit.dev/providers',
        {
          headers: {
            'x-api-key': apiKey
          }
        }
      )

      if (!providersResponse.ok) {
        throw new Error(
          `Failed to fetch SwapKit providers: ${providersResponse.statusText}`
        )
      }

      const providersText = await providersResponse.text()
      const providers = asJSON(asSwapKitResponse)(providersText)

      // Extract provider names from the providers response
      const providerNames = new Set<string>()
      providers.forEach(provider => {
        // Provider name might be in various fields due to withRest
        const name =
          (provider as any).name ??
          (provider as any).provider ??
          (provider as any).id
        if (name != null && typeof name === 'string') {
          providerNames.add(name.toUpperCase())
        }
      })

      const chainTickers = new Set<string>()

      // Query tokens from each provider
      for (const providerName of providerNames) {
        try {
          const tokensResponse = await fetch(
            `https://api.swapkit.dev/tokens?provider=${providerName}`,
            {
              headers: {
                accept: 'application/json',
                'x-api-key': apiKey
              }
            }
          )

          if (!tokensResponse.ok) {
            console.warn(
              `Failed to fetch tokens for provider ${providerName}: ${tokensResponse.statusText}`
            )
            continue
          }

          const tokensText = await tokensResponse.text()
          const tokensData = asJSON(asSwapKitTokensResponse)(tokensText)

          // Extract unique chain ticker codes from tokens
          // The `chain` field contains the ticker code (e.g., "BTC", "ETH", "SOL")
          tokensData.tokens.forEach(token => {
            if (token.chain != null && token.chain !== '') {
              chainTickers.add(token.chain)
            }
          })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(
            `Error fetching tokens for provider ${providerName}:`,
            message
          )
          // Continue with other providers
        }
      }

      if (chainTickers.size === 0) {
        throw new Error(
          'No chain tickers extracted from any provider. Check API key and provider availability.'
        )
      }

      return Array.from(chainTickers).map(ticker => ({
        chainCode: ticker,
        metadata: {
          'Display Name': ticker
        }
      }))
    }
  }
}
