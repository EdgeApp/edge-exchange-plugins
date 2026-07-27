# Swap Plugin Architecture

**Date**: 2025-08-20

## Overview

Edge exchange plugins follow a consistent architecture pattern for implementing swap providers. This document describes the standard patterns used across all swap plugins and how they integrate with edge-core-js.

## Plugin System Fundamentals

### How Plugins Attach to Core

Edge plugins are registered with edge-core-js through a plugin map that gets passed during context creation:

```typescript
// In src/index.ts - the main entry point
import { make0xGaslessPlugin } from "./swap/defi/0x/0xGasless";
import { makeChangeNowPlugin } from "./swap/central/changenow";
import { makeThorchainPlugin } from "./swap/defi/thorchain/thorchain";

const plugins = {
  // Plugin ID maps to factory function
  "0xgasless": make0xGaslessPlugin,
  changenow: makeChangeNowPlugin,
  thorchain: makeThorchainPlugin,
  // ... more plugins
};

// When edge-core-js initializes, it calls these factory functions
// with EdgeCorePluginOptions to create the actual plugin instances
```

### Plugin Factory Pattern

Every swap plugin exports a factory function that creates the plugin instance:

```typescript
// Factory function signature - always follows this pattern
export function makeMyExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  // EdgeCorePluginOptions provides:
  // - initOptions: API keys and config from the app
  // - io: Network, crypto, and storage functions
  // - log: Scoped logging for this plugin
  // - pluginDisklet: Plugin-specific storage

  // Validate init options (API keys, etc.)
  const initOptions = asInitOptions(opts.initOptions);

  // Return the EdgeSwapPlugin interface
  return {
    swapInfo, // Static metadata about this plugin

    // Required: Main quote fetching method
    async fetchSwapQuote(
      request: EdgeSwapRequest,
      userSettings: JsonObject | undefined,
      opts: { infoPayload: JsonObject; promoCode?: string }
    ): Promise<EdgeSwapQuote> {
      // Implementation
    },

    // Optional: Check if plugin needs activation
    checkSettings: (userSettings: JsonObject) => EdgeSwapPluginStatus,
  };
}

// Init options validation using cleaners
const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString),
});
```

### SwapInfo Object

Every plugin must export a `swapInfo` object that identifies the plugin:

```typescript
export const swapInfo: EdgeSwapInfo = {
  pluginId: "changenow", // Unique identifier matching src/index.ts
  isDex: false, // true for DEX, false/undefined for CEX
  displayName: "ChangeNOW", // User-facing name
  supportEmail: "support@changenow.io",
};
```

The `pluginId` in `swapInfo` must match the key used in `src/index.ts` for proper registration.

### Plugin Lifecycle

1. **Registration**: Plugin factory functions are exported from `src/index.ts`
2. **Initialization**: Edge-core-js calls factory functions with `EdgeCorePluginOptions`
3. **Configuration**: Plugins receive API keys via `initOptions` and runtime settings via `userSettings`
4. **Quote Requests**: Core calls `fetchSwapQuote` when users request swaps
5. **Quote Execution**: Returned quotes include an `approve()` method for execution

## Plugin Categories

### 1. Centralized Exchange Plugins (`src/swap/central/`)

- Direct API integration with centralized exchanges
- Examples: ChangeHero, ChangeNOW, Godex, LetsExchange
- Pattern: API key authentication, order creation, status polling

### 2. DEX/DeFi Plugins (`src/swap/defi/`)

- On-chain decentralized exchanges
- Examples: THORChain, Uniswap V2 forks, 0x Protocol
- Pattern: Smart contract interaction, gas estimation, slippage handling

### 3. Transfer Plugin (`src/swap/transfer.ts`)

- Special plugin for same-currency transfers between wallets
- No actual swap, just moves funds

## Plugin Expectations and Requirements

### API-Driven Validation Principle

**Critical**: All validation must come from your exchange's API response, not hardcoded values. Each exchange has its own API format:

```typescript
// ❌ BAD - Hardcoded validation
const MIN_BTC = "0.001";
const MAX_BTC = "10";
if (lt(amount, MIN_BTC)) throw new SwapBelowLimitError(swapInfo, MIN_BTC);

// ✅ GOOD - Real example from ChangeNow plugin
const marketRangeResponse = await fetch(`/market-info/range/${fromTo}`);
const { minAmount, maxAmount } = await marketRangeResponse.json();

if (lt(amount, minAmount)) {
  const minNative = await denominationToNative(minAmount);
  throw new SwapBelowLimitError(swapInfo, minNative);
}

// ✅ GOOD - Real example from SideShift plugin
const quoteResponse = await fetch("/quotes", { body: quoteRequest });
if (quoteResponse.error?.message) {
  if (/below-min/i.test(quoteResponse.error.message)) {
    throw new SwapBelowLimitError(swapInfo, quoteResponse.min);
  }
}
```

Your exchange API should provide:

- Supported asset pairs dynamically (not hardcoded lists)
- Current min/max limits for each specific pair
- Region restrictions or geo-blocking status
- Available liquidity and current rates

## Plugin Expectations and Requirements

### Chain Support Mapping

Plugins must properly map Edge pluginIds to exchange-specific identifiers:

```typescript
// Map Edge pluginId to your exchange's chain identifiers
const PLUGIN_ID_MAP: Record<string, string> = {
  bitcoin: "btc",
  ethereum: "eth",
  binancesmartchain: "bsc",
  avalanche: "avax",
  // Add all supported chains
};

// The pluginId uniquely identifies the network
const fromPluginId = request.fromWallet.currencyInfo.pluginId; // e.g. 'ethereum'
const toPluginId = request.toWallet.currencyInfo.pluginId; // e.g. 'bitcoin'

// Map to your exchange's format
const fromChain = PLUGIN_ID_MAP[fromPluginId];
const toChain = PLUGIN_ID_MAP[toPluginId];
```

### Accessing Request Parameters

The `EdgeSwapRequest` provides all necessary information:

```typescript
interface EdgeSwapRequest {
  fromWallet: EdgeCurrencyWallet; // Source wallet with currencyInfo and currencyConfig
  toWallet: EdgeCurrencyWallet; // Destination wallet
  fromTokenId: EdgeTokenId | null; // Token identifier or null for native currency
  toTokenId: EdgeTokenId | null; // Token identifier or null for native currency
  nativeAmount: string; // Amount in smallest unit (satoshis, wei, etc.)
  quoteFor: "from" | "to" | "max"; // Quote direction
}

// Access wallet information
const fromWallet = request.fromWallet;
const fromCurrencyInfo = fromWallet.currencyInfo; // EdgeCurrencyInfo
const fromCurrencyConfig = fromWallet.currencyConfig; // EdgeCurrencyConfig

// Plugin IDs uniquely identify the network
const fromPluginId = fromCurrencyInfo.pluginId; // e.g. 'ethereum', 'bitcoin'
const toPluginId = request.toWallet.currencyInfo.pluginId;

// Token handling
const fromTokenId = request.fromTokenId; // null for native/mainnet currency (ETH, BTC, etc.)
const toTokenId = request.toTokenId; // string identifier for tokens

// For chains with tokens, tokenId identifies the specific token
if (fromTokenId != null) {
  // This is a token swap, not the native currency
  // The tokenId format depends on the chain (contract address, asset ID, etc.)
}

// Map Edge identifiers to exchange symbols
const fromSymbol = getExchangeSymbol(request.fromWallet, request.fromTokenId);
const toSymbol = getExchangeSymbol(request.toWallet, request.toTokenId);

// Helper to map wallet/tokenId to exchange symbol
function getExchangeSymbol(
  wallet: EdgeCurrencyWallet,
  tokenId: EdgeTokenId
): string {
  const pluginId = wallet.currencyInfo.pluginId;

  // Your exchange-specific mapping logic
  return mapToExchangeSymbol(pluginId, tokenId);
}
```

### Transaction Fee Estimation

**Critical**: Plugins must create actual transactions to get accurate fee estimates:

```typescript
// For DEX plugins - create the actual swap transaction
const swapTx = await makeSwapTransaction(params);
const networkFee = swapTx.networkFees[0]; // networkFees is an array of EdgeTxAmount

// For centralized exchanges - estimate deposit transaction
const depositAddress = await getDepositAddress();
const spendInfo: EdgeSpendInfo = {
  tokenId: request.fromTokenId,
  spendTargets: [
    {
      nativeAmount: request.nativeAmount,
      publicAddress: depositAddress,
    },
  ],
};
const tx = await request.fromWallet.makeSpend(spendInfo);
const networkFee = tx.networkFees[0]; // networkFees is an array of EdgeTxAmount

// Return fee in the quote
return {
  ...quote,
  networkFee: {
    tokenId: networkFee.tokenId,
    nativeAmount: networkFee.nativeAmount,
    currencyCode: "", // deprecated field, but still required by type
  },
};

// Include in quote approval info
quote.approveInfo = {
  ...approveInfo,
  customFee: {
    nativeAmount: networkFee,
  },
};
```

### Quote Types: Fixed vs Variable

Specify quote behavior clearly:

```typescript
// EdgeSwapQuote properties for quote types
interface EdgeSwapQuote {
  isEstimate: boolean; // true for variable rates, false for fixed
  expirationDate?: Date; // When this quote expires
  canBePartial?: boolean; // Can fulfill partially
  maxFulfillmentSeconds?: number; // Max time to complete
  minReceiveAmount?: string; // Worst-case receive amount

  fromNativeAmount: string; // Input amount
  toNativeAmount: string; // Output amount (estimated or guaranteed)
}

// Fixed quote example
return {
  ...quote,
  isEstimate: false,
  expirationDate: new Date(Date.now() + 600 * 1000), // 10 minutes
  toNativeAmount: guaranteedAmount,
};

// Variable quote example
return {
  ...quote,
  isEstimate: true,
  toNativeAmount: estimatedAmount,
  minReceiveAmount: minAmount,
};
```

### Reverse Quotes

Support both forward and reverse quotes:

```typescript
async function fetchSwapQuote(
  request: EdgeSwapRequest
): Promise<EdgeSwapQuote> {
  const { quoteFor } = request;

  switch (quoteFor) {
    case "from":
      // User specified source amount, calculate destination
      return fetchForwardQuote(request);

    case "to":
      // User specified destination amount, calculate source
      return fetchReverseQuote(request);

    case "max":
      // Use maximum available balance
      const maxAmount = await getMaxSwappable(request);
      return fetchQuoteWithAmount(request, maxAmount);
  }
}
```

### Error Handling Requirements

Always throw errors based on API response with proper priority:

```typescript
// Each exchange has unique API response formats
// Here are real examples from actual plugins:

// Example: SideShift checks error message strings
async function handleSideshiftError(
  response: { error?: { message: string } },
  swapInfo: EdgeSwapInfo,
  request: EdgeSwapRequest
): void {
  const errorMsg = response.error?.message || "";

  // 1. Region restrictions (highest priority)
  if (/country-blocked/i.test(errorMsg)) {
    throw new SwapPermissionError(swapInfo, "geoRestriction");
  }

  // 2. Asset support
  if (/pair-not-active/i.test(errorMsg)) {
    throw new SwapCurrencyError(swapInfo, request);
  }

  // 3. Amount limits
  if (/below-min/i.test(errorMsg)) {
    // SideShift includes min in error response
    throw new SwapBelowLimitError(swapInfo, response.min);
  }
}

// Example: ChangeNow uses separate API calls for limits
async function handleChangeNowQuote(
  exchangeResponse: any,
  swapInfo: EdgeSwapInfo,
  request: EdgeSwapRequest
): void {
  // Check general errors
  if (exchangeResponse.error != null) {
    throw new SwapCurrencyError(swapInfo, request);
  }

  // Separate API call for min/max limits
  const marketRange = await fetchMarketRange(pair);
  if (lt(amount, marketRange.minAmount)) {
    const minNative = await denominationToNative(marketRange.minAmount);
    throw new SwapBelowLimitError(swapInfo, minNative);
  }
}

// Example: LetsExchange uses HTTP status codes
async function handleLetsExchangeResponse(
  response: Response,
  swapInfo: EdgeSwapInfo,
  request: EdgeSwapRequest
): void {
  // HTTP 422 = validation error (unsupported pair or amount)
  if (response.status === 422) {
    throw new SwapCurrencyError(swapInfo, request);
  }

  if (!response.ok) {
    throw new Error(`LetsExchange error ${response.status}`);
  }
}

// Network errors
try {
  const response = await fetch(url);
} catch (error) {
  console.error(`${pluginId} network error:`, error);
  throw error;
}
```

## Important: Exchange API Diversity

**Every exchange has a unique API response format.** There is no standard structure for error messages, limits, or validation responses. When implementing a new plugin:

1. **Study your exchange's actual API responses** - Don't assume any standard format
2. **Map exchange-specific responses to Edge error types** - Each exchange requires custom error parsing
3. **Test with real API calls** - Verify error handling with actual API responses
4. **Document exchange-specific quirks** - Help future maintainers understand the API's behavior

Examples of API diversity:

- **SideShift**: Returns errors in `error.message` field with descriptive strings
- **ChangeNow**: Uses separate endpoints for quotes vs min/max limits
- **LetsExchange**: Relies on HTTP status codes (422 for validation errors)
- **Godex**: Has its own unique error codes and response structure
- **Exolix**: Different field names and error formats entirely

## Common Patterns

### Asset Validation

```typescript
// Map pluginId/tokenId to exchange symbols
const fromSymbol = mapToExchangeSymbol(request.fromWallet, request.fromTokenId);
const toSymbol = mapToExchangeSymbol(request.toWallet, request.toTokenId);

// Let the API validate supported assets
const apiResponse = await fetchQuote(fromSymbol, toSymbol, amount);

// Validate based on API response
if (!apiResponse.assetSupported) {
  throw new SwapCurrencyError(swapInfo, request);
}
```

### Quote Request Pattern

```typescript
async function fetchSwapQuote(
  request: EdgeSwapRequest
): Promise<EdgeSwapQuote> {
  // 1. Map Edge identifiers to exchange symbols
  const fromSymbol = mapToExchangeSymbol(
    request.fromWallet,
    request.fromTokenId
  );
  const toSymbol = mapToExchangeSymbol(request.toWallet, request.toTokenId);

  // 2. Convert request to exchange API format
  const convertedRequest = await convertRequest(request, fromSymbol, toSymbol);

  // 3. Fetch quote from API (includes validation data)
  const apiQuote = await fetchQuoteFromApi(convertedRequest);

  // 4. Validate based on API response with proper priority
  validateApiResponse(apiQuote, request, swapInfo);

  // 5. Create and return EdgeSwapQuote
  return makeSwapPluginQuote({
    request,
    swapInfo,
    // Quote details from API
  });
}
```

### Approval Pattern (DEX)

```typescript
const spendInfo: EdgeSpendInfo = {
  // Approval transaction first
  spendTargets: [
    {
      nativeAmount: "0",
      publicAddress: APPROVAL_CONTRACT,
    },
  ],
  // Then swap transaction
};
```

## Utility Functions

### makeSwapPluginQuote

Standard utility for creating quotes:

```typescript
import { makeSwapPluginQuote } from "../../util/swapHelpers";

const quote = await makeSwapPluginQuote({
  request,
  swapInfo,
  fetchSwapQuote,
  checkWhitelistedMainnetCodes,
  // Additional quote details
});
```

### convertRequest

Converts Edge request format to plugin-specific format:

```typescript
const convertedRequest = await convertRequest(request);
// Returns: amount, fromAddress, toAddress, etc.
```

## Error Handling Patterns

### Standard Swap Errors

- `SwapCurrencyError`: Unsupported currency pair
- `SwapBelowLimitError`: Amount too small
- `SwapAboveLimitError`: Amount too large
- `InsufficientFundsError`: Not enough balance

### Network Error Handling

```typescript
try {
  const response = await fetch(url);
} catch (error) {
  // Log and rethrow with context
  console.error(`${pluginId} fetchQuote error:`, error);
  throw error;
}
```

## Testing Patterns

### Mock Data

- Use `test/fake*.ts` files for mock currency info
- Create standardized test cases in `test/` directory

### Integration Tests

```typescript
describe("SwapPlugin", () => {
  it("should fetch quote", async () => {
    const quote = await plugin.fetchSwapQuote(mockRequest);
    expect(quote.fromNativeAmount).to.equal("1000000000");
  });
});
```

## Best Practices

1. **Use API for all validation** - Never hardcode limits, supported assets, or restrictions
2. **Map pluginId/tokenId to symbols** - Always translate Edge identifiers to exchange symbols
3. **Use biggystring** for all numeric comparisons
4. **Include detailed metadata** in quotes (order ID, etc.)
5. **Handle rate limiting** with appropriate delays
6. **Log errors with context** for debugging
7. **Test with mainnet and testnet** assets
8. **Create actual transactions** for accurate fee estimation
9. **Handle destination tags/memos** for chains that require them
10. **Specify quote type** (fixed vs variable) clearly
11. **Support all quote directions** (from, to, max)
12. **Follow error priority** - Region → Asset support → Limits
13. **Provide specific error messages** with support context
