import { asMaybe } from 'cleaners'
import { EdgeIo } from 'edge-core-js'
import { FetchResponse } from 'serverlet'

import {
  asErrorResponse,
  asGaslessSwapQuoteResponse,
  asGaslessSwapStatusResponse,
  asGaslessSwapSubmitResponse,
  ChainId,
  GaslessSwapQuoteRequest,
  GaslessSwapQuoteResponse,
  GaslessSwapStatusResponse,
  GaslessSwapSubmitRequest,
  GaslessSwapSubmitResponse,
  SwapQuoteRequest
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
   * Retrieves the ChainId based on the provided pluginId.
   *
   * @param pluginId The currency pluginId to retrieve the ChainId for.
   * @returns The ChainId associated with the pluginId.
   * @throws Error if the pluginId is not supported.
   */
  getChainIdFromPluginId(pluginId: string): ChainId {
    switch (pluginId) {
      case 'arbitrum':
        return ChainId.Arbitrum
      case 'base':
        return ChainId.Base
      case 'ethereum':
        return ChainId.Ethereum
      case 'optimism':
        return ChainId.Optimism
      case 'polygon':
        return ChainId.Polygon
      default:
        throw new Error(
          `ZeroXApi: Unsupported ChainId for currency plugin: '${pluginId}'`
        )
    }
  }

  /**
   * Get the 0x API endpoint based on the currency plugin ID. The endpoint is
   * the appropriate 0x API server for a particular network (Ethereum, Polygon,
   * etc).
   *
   * @param pluginId Currency plugin ID
   * @returns The 0x API endpoint URL
   * @throws Error if the pluginId is not supported.
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
        throw new Error(
          `ZeroXApi: Unsupported endpoint for currency plugin: '${pluginId}'`
        )
    }
  }

  /**
   * Retrieves a gasless swap quote from the API.
   *
   * @param {ChainId} chainId - The ID of the chain (see {@link getChainIdFromPluginId}).
   * @param {GaslessSwapQuoteRequest} request - The request object containing
   * the necessary parameters for the swap quote.
   * @returns {Promise<GaslessSwapQuoteResponse>} - A promise that resolves to
   * the gasless swap quote response.
   */
  async gaslessSwapQuote(
    chainId: ChainId,
    request: GaslessSwapQuoteRequest
  ): Promise<GaslessSwapQuoteResponse> {
    // Gasless API uses the Ethereum network
    const endpoint = this.getEndpointFromPluginId('ethereum')

    const queryParams = requestToParams(request)
    const queryString = new URLSearchParams(queryParams).toString()

    const response = await this.io.fetch(
      `${endpoint}/tx-relay/v1/swap/quote?${queryString}`,
      {
        headers: {
          'content-type': 'application/json',
          '0x-api-key': this.apiKey,
          '0x-chain-id': chainId.toString()
        }
      }
    )

    if (!response.ok) {
      await handledErrorResponse(response)
    }

    const responseText = await response.text()
    const responseData = asGaslessSwapQuoteResponse(responseText)

    return responseData
  }

  /**
   * Submits a gasless swap request to the 0x API.
   *
   * @param chainId - The chain ID of the network.
   * @param request - The gasless swap submit request.
   * @returns A promise that resolves to the gasless swap response.
   */
  async gaslessSwapSubmit(
    chainId: ChainId,
    request: GaslessSwapSubmitRequest
  ): Promise<GaslessSwapSubmitResponse> {
    // Gasless API uses the Ethereum network
    const endpoint = this.getEndpointFromPluginId('ethereum')

    const response = await this.io.fetch(
      `${endpoint}/tx-relay/v1/swap/submit`,
      {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          '0x-api-key': this.apiKey,
          '0x-chain-id': chainId.toString()
        }
      }
    )

    if (!response.ok) {
      await handledErrorResponse(response)
    }

    const responseText = await response.text()
    const responseData = asGaslessSwapSubmitResponse(responseText)

    return responseData
  }

  async gaslessSwapStatus(
    chainId: ChainId,
    tradeHash: string
  ): Promise<GaslessSwapStatusResponse> {
    // Gasless API uses the Ethereum network
    const endpoint = this.getEndpointFromPluginId('ethereum')

    const response = await this.io.fetch(
      `${endpoint}/tx-relay/v1/swap/status/${tradeHash}`,
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          '0x-api-key': this.apiKey,
          '0x-chain-id': chainId.toString()
        }
      }
    )

    if (!response.ok) {
      await handledErrorResponse(response)
    }

    const responseText = await response.text()
    const responseData = asGaslessSwapStatusResponse(responseText)

    return responseData
  }
}

async function handledErrorResponse(response: FetchResponse): Promise<void> {
  const responseText = await response.text()
  const errorResponse = asMaybe(asErrorResponse)(responseText)

  // If error response cleaner failed, then throw the raw response text
  if (errorResponse == null) {
    let truncatedText = responseText.slice(0, 500) // Truncate to 500 characters
    if (truncatedText !== responseText) {
      truncatedText += '...'
    }
    throw new Error(`0x API HTTP ${response.status} response: ${truncatedText}`)
  }

  // Throw error with response code and reason included
  const { code, reason } = errorResponse
  throw new Error(
    `0x API HTTP ${response.status} response: code=${code} reason=${reason}`
  )
}

/**
 * Removes undefined fields from a API request objects and returns a Record
 * type object which can be parsed using `URLSearchParams`.
 *
 * @param request - The request object with partial fields.
 * @returns The params object containing only string values.
 */
function requestToParams(request: SwapQuoteRequest): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key in request) {
    if (Object.hasOwnProperty.call(request, key)) {
      const value = request[key as keyof SwapQuoteRequest] // Add index signature
      if (value !== undefined) {
        result[key] = value
      }
    }
  }
  return result
}
