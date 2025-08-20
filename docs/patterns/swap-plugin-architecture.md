# Swap Plugin Architecture

**Date**: 2025-08-20

## Overview

Edge exchange plugins follow a consistent architecture pattern for implementing swap providers. This document describes the standard patterns used across all swap plugins.

## Plugin Structure

### Basic Plugin Factory Pattern

```typescript
export function makeSwapPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
  const initOptions = asInitOptions(opts.initOptions);

  return {
    swapInfo,

    async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
      // Implementation
    },
  };
}
```

### SwapInfo Object

Every plugin must export a `swapInfo` object:

```typescript
export const swapInfo: EdgeSwapInfo = {
  pluginId: "changenow",
  isDex: false, // true for DEX plugins
  displayName: "ChangeNOW",
  supportEmail: "support@changenow.io",
};
```

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

## Common Patterns

### Currency Code Validation

```typescript
// Check supported currencies
const isFromCurrencySupported = checkInvalidCodes(
  fromCodes,
  InvalidCurrencyCodes
);
const isToCurrencySupported = checkInvalidCodes(toCodes, InvalidCurrencyCodes);

if (!isFromCurrencySupported || !isToCurrencySupported) {
  throw new SwapCurrencyError(
    swapInfo,
    request.fromCurrencyCode,
    request.toCurrencyCode
  );
}
```

### Quote Request Pattern

```typescript
async function fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
  // 1. Validate currencies
  checkInvalidCodes(...)

  // 2. Convert request to internal format
  const convertedRequest = await convertRequest(request)

  // 3. Fetch quote from API
  const apiQuote = await fetchQuoteFromApi(convertedRequest)

  // 4. Validate limits
  if (lt(amount, min)) throw new SwapBelowLimitError(swapInfo, min)
  if (gt(amount, max)) throw new SwapAboveLimitError(swapInfo, max)

  // 5. Create and return EdgeSwapQuote
  return makeSwapPluginQuote({
    // Quote details
  })
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

1. **Always validate currency codes** before making API calls
2. **Use biggystring** for all numeric comparisons
3. **Include detailed metadata** in quotes (order ID, etc.)
4. **Handle rate limiting** with appropriate delays
5. **Log errors with context** for debugging
6. **Test with mainnet and testnet** currency codes
