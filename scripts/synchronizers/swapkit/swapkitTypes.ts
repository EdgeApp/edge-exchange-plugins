import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'

const asSwapKitProvider = asObject({
  supportedChainIds: asOptional(asArray(asString), []),
  enabledChainIds: asOptional(asArray(asString), [])
}).withRest

export const asSwapKitResponse = asArray(asSwapKitProvider)

// Token response format based on SwapKit API docs
// https://docs.swapkit.dev/swapkit-api/tokens-request-supported-tokens-by-a-swap-provider
const asSwapKitToken = asObject({
  chain: asString, // The blockchain ticker (e.g., "BTC", "ETH", "SOL")
  chainId: asOptional(asString), // The chain ID (e.g., "bitcoin", "42161", "solana")
  ticker: asOptional(asString), // The token ticker symbol
  identifier: asOptional(asString), // Format: "CHAIN.TICKER" or "CHAIN.TICKER-CONTRACT"
  symbol: asOptional(asString),
  name: asOptional(asString),
  decimals: asOptional(asNumber), // Number, not string (e.g., 18, 8, 6)
  address: asOptional(asString),
  logoURI: asOptional(asString),
  coingeckoId: asOptional(asString),
  shortCode: asOptional(asString)
}).withRest

const asSwapKitTokensResponse = asObject({
  provider: asOptional(asString),
  name: asOptional(asString),
  timestamp: asOptional(asString),
  count: asOptional(asNumber),
  tokens: asArray(asSwapKitToken)
})

export { asSwapKitTokensResponse }
