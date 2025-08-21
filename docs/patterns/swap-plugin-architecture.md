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
  fromTokenId: EdgeTokenId | null; // Token identifier or null for native/mainnet token
  toTokenId: EdgeTokenId | null; // Token identifier or null for native/mainnet token
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
const fromTokenId = request.fromTokenId; // null for mainnet token (ETH, BTC, etc.)
const toTokenId = request.toTokenId; // string for tokens (contract address on EVM)

// For EVM chains, tokenId is the contract address
if (fromTokenId != null && fromPluginId === "ethereum") {
  const contractAddress = fromTokenId; // This IS the contract address
}

// Get currency codes
const fromCurrencyCode = request.fromCurrencyCode; // e.g. 'ETH', 'USDC'
const toCurrencyCode = request.toCurrencyCode;
```

### Transaction Fee Estimation

**Critical**: Plugins must create actual transactions to get accurate fee estimates:

```typescript
// For DEX plugins - create the actual swap transaction
const swapTx = await makeSwapTransaction(params);
const networkFee = swapTx.networkFee;

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
const networkFee = tx.networkFee;

// Return fee in the quote
return {
  ...quote,
  networkFee: {
    currencyCode: fromWallet.currencyInfo.currencyCode,
    nativeAmount: networkFee,
  },
};
```

### Destination Tags and Memos

Handle destination tags/memos for chains that require them:

```typescript
// Check if destination requires memo
const { publicAddress, tag } = await getAddress(request.toWallet);

// For XRP, XLM, etc.
if (tag != null) {
  spendInfo.spendTargets[0].uniqueIdentifier = tag;
}

// For Cosmos-based chains
if (memo != null) {
  spendInfo.memo = memo;
}

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
interface EdgeSwapQuote {
  isEstimate: boolean; // true for variable rates, false for fixed
  expirationDate?: Date; // Required for fixed quotes

  // For fixed quotes
  guaranteedAmount?: string; // The guaranteed output amount

  // For variable quotes
  minReceiveAmount?: string; // Minimum possible output
  maxReceiveAmount?: string; // Maximum possible output
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

Provide specific, actionable error messages:

```typescript
// Currency not supported
throw new SwapCurrencyError(swapInfo, fromCode, toCode);

// Amount validation
if (lt(amount, minimum)) {
  throw new SwapBelowLimitError(swapInfo, minimum, fromCode);
}
if (gt(amount, maximum)) {
  throw new SwapAboveLimitError(swapInfo, maximum, fromCode);
}

// Network or API errors
try {
  const response = await fetch(url);
} catch (error) {
  console.error(`${pluginId} network error:`, error);
  // Include request ID if available for support
  throw new Error(`Network error: ${error.message}. Request ID: ${requestId}`);
}

// Insufficient liquidity
if (response.error === "INSUFFICIENT_LIQUIDITY") {
  throw new InsufficientLiquidityError(swapInfo, {
    fromCode,
    toCode,
    amount,
  });
}
```

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
7. **Create actual transactions** for accurate fee estimation
8. **Handle destination tags/memos** for chains that require them
9. **Specify quote type** (fixed vs variable) clearly
10. **Support all quote directions** (from, to, max)
11. **Map chains correctly** using pluginId and chain IDs
12. **Provide specific error messages** with support context
