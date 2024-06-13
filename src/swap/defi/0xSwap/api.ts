import { asMaybe } from 'cleaners'
import { EdgeIo } from 'edge-core-js'
import { FetchResponse } from 'serverlet'

import {
  asErrorResponse,
  asQuoteResponse,
  QuoteRequest,
  QuoteResponse
} from './apiTypes'

/**
 * Represents the ZeroXApi class that interacts with the 0x API.
 */
export class ZeroXApi {
  apiKey: string
  io: EdgeIo

  constructor(io: EdgeIo, apiKey: string) {
    this.apiKey = apiKey
    this.io = io
  }

  /**
   * Get the 0x API endpoint based on the currency plugin ID. The endpoint is
   * the appropriate 0x API server for a particular network (Ethereum, Polygon,
   * etc).
   *
   * @param pluginId Currency plugin ID
   * @returns The 0x API endpoint URL
   */
  getEndpointFromPluginId(pluginId: string): string {
    switch (pluginId) {
      case 'arbitrum':
        return 'https://arbitrum.api.0x.org'
      case 'avalanche':
        return 'https://avalanche.api.0x.org'
      case 'binancesmartchain':
        return 'https://bsc.api.0x.org'
      case 'base':
        return 'https://base.api.0x.org'
      case 'celo':
        return 'https://celo.api.0x.org'
      case 'ethereum':
        return 'https://api.0x.org'
      case 'fantom':
        return 'https://fantom.api.0x.org'
      case 'optimism':
        return 'https://optimism.api.0x.org'
      case 'polygon':
        return 'https://polygon.api.0x.org'
      case 'sepolia':
        return 'https://sepolia.api.0x.org'
      default:
        throw new Error(`ZeroXApi: Unsupported currency plugin: '${pluginId}'`)
    }
  }

  /**
   * Request a quote from the 0x API.
   *
   * @param endpoint The 0x API endpoint URL (see {@link getEndpointFromPluginId})
   * @param quoteRequest Parameters for the quote request
   * @returns QuoteResponse object from the 0x API
   */
  async quote(
    endpoint: string,
    quoteRequest: QuoteRequest
  ): Promise<QuoteResponse> {
    const queryParams = removePartialFieldsFromRecord(quoteRequest)
    const queryString = new URLSearchParams(queryParams).toString()

    const response = await this.io.fetch(
      `${endpoint}/swap/v1/quote?${queryString}`,
      {
        headers: {
          'content-type': 'application/json',
          '0x-api-key': this.apiKey
        }
      }
    )

    if (!response.ok) {
      await this.handledErrorResponse(response)
    }

    const responseText = await response.text()
    const responseData = asQuoteResponse(responseText)

    return responseData
  }

  private async handledErrorResponse(response: FetchResponse): Promise<void> {
    const responseText = await response.text()
    const errorResponse = asMaybe(asErrorResponse)(responseText)

    // If error response cleaner failed, then throw the raw response text
    if (errorResponse == null) {
      let truncatedText = responseText.slice(0, 500) // Truncate to 500 characters
      if (truncatedText !== responseText) {
        truncatedText += '...'
      }
      throw new Error(
        `0x API HTTP ${response.status} response: ${truncatedText}`
      )
    }

    // Throw error with response code and reason included
    const { code, reason } = errorResponse
    throw new Error(
      `0x API HTTP ${response.status} response: code=${code} reason=${reason}`
    )
  }
}

/**
 * Removes undefined fields from a Record type object.
 *
 * @param obj - The object with partial fields.
 * @returns The object with undefined fields removed.
 */
function removePartialFieldsFromRecord(
  obj: Partial<Record<string, string>>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key in obj) {
    if (Object.hasOwnProperty.call(obj, key)) {
      const value = obj[key]
      if (value !== undefined) {
        result[key] = value
      }
    }
  }
  return result
}
