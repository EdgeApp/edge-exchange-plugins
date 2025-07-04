import { asMaybe } from 'cleaners'
import { EdgeIo, EdgeSwapInfo, SwapBelowLimitError } from 'edge-core-js'
import { FetchResponse } from 'serverlet'

import {
  asErrorResponse,
  asGaslessSwapQuoteResponse,
  asGaslessSwapStatusResponse,
  asGaslessSwapSubmitResponse,
  asSellAmountTooSmallError,
  ChainId,
  GaslessSwapQuoteRequest,
  GaslessSwapQuoteResponse,
  GaslessSwapStatusResponse,
  GaslessSwapSubmitRequest,
  GaslessSwapSubmitResponse,
  SwapQuoteRequest
} from './zeroXApiTypes'

// In v2, all chains use the same endpoint
const ZEROX_V2_BASE_URL = 'https://api.0x.org'

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
      case 'avalanche':
        return ChainId.Avalanche
      case 'base':
        return ChainId.Base
      case 'binancesmartchain':
        return ChainId.BinanceSmartChain
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
   * Retrieves a gasless swap quote from the API.
   *
   * @param {ChainId} chainId - The ID of the chain (see {@link getChainIdFromPluginId}).
   * @param {GaslessSwapQuoteRequest} request - The request object containing
   * the necessary parameters for the swap quote.
   * @returns {Promise<GaslessSwapQuoteResponse>} - A promise that resolves to
   * the gasless swap quote response.
   */
  async gaslessSwapQuote(
    swapInfo: EdgeSwapInfo,
    chainId: ChainId,
    request: Omit<GaslessSwapQuoteRequest, 'chainId'>
  ): Promise<GaslessSwapQuoteResponse> {
    // Create a new request object with chainId included
    const fullRequest: GaslessSwapQuoteRequest = {
      ...request,
      chainId
    }

    const queryParams = requestToParams(fullRequest)
    const queryString = new URLSearchParams(queryParams).toString()

    const response = await this.io.fetch(
      `${ZEROX_V2_BASE_URL}/gasless/quote?${queryString}`,
      {
        headers: {
          'content-type': 'application/json',
          '0x-api-key': this.apiKey,
          '0x-version': 'v2'
        }
      }
    )

    if (!response.ok) {
      await handledErrorResponse(response, swapInfo)
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
    request: Omit<GaslessSwapSubmitRequest, 'chainId'>
  ): Promise<GaslessSwapSubmitResponse> {
    // Create a new request object with chainId included
    const fullRequest: GaslessSwapSubmitRequest = {
      ...request,
      chainId
    }

    const response = await this.io.fetch(
      `${ZEROX_V2_BASE_URL}/gasless/submit`,
      {
        method: 'POST',
        body: JSON.stringify(fullRequest),
        headers: {
          'content-type': 'application/json',
          '0x-api-key': this.apiKey,
          '0x-version': 'v2'
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

  /**
   * Retrieves the status of a gasless swap from the API.
   *
   * @param chainId - The chain ID of the network.
   * @param tradeHash - The trade hash returned from the submit endpoint.
   * @returns A promise that resolves to the gasless swap status response.
   */
  async gaslessSwapStatus(
    chainId: ChainId,
    tradeHash: string
  ): Promise<GaslessSwapStatusResponse> {
    const response = await this.io.fetch(
      `${ZEROX_V2_BASE_URL}/gasless/status/${tradeHash}?chainId=${chainId}`,
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          '0x-api-key': this.apiKey,
          '0x-version': 'v2'
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

async function handledErrorResponse(
  response: FetchResponse,
  swapInfo?: EdgeSwapInfo
): Promise<void> {
  const responseText = await response.text()

  // Look for SwapBelowLimitError
  if (swapInfo != null) {
    const sellAmountTooSmallError = asMaybe(asSellAmountTooSmallError)(
      responseText
    )
    if (sellAmountTooSmallError != null) {
      const { minSellAmount } = sellAmountTooSmallError.data
      throw new SwapBelowLimitError(swapInfo, minSellAmount)
    }
  }

  // Try to parse as a standard error response
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
