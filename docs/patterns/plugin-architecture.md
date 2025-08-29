# Plugin Architecture Patterns

## Overview

Edge Exchange Plugins follows a modular plugin architecture that separates concerns and enables lazy loading of expensive dependencies.

## Core Patterns

### 1. Plugin Factory Pattern

Every plugin is created through a factory function that receives configuration options:

```typescript
type EdgeCorePluginFactory = (env: EdgeCorePluginOptions) => EdgeSwapPlugin;
```

This pattern provides:

- Dependency injection via `EdgeCorePluginOptions`
- Configuration through `initOptions`
- Access to core utilities (`io`, `log`)

### 2. Inner/Outer Plugin Pattern

The `makeSwapPlugin` utility implements a two-layer architecture:

```typescript
export interface OuterPlugin {
  swapInfo: EdgeSwapInfo           // Static metadata
  checkEnvironment?: () => void    // Runtime validation
  getInnerPlugin: () => Promise<InnerPlugin>  // Lazy loading
}

export interface InnerPlugin {
  fetchSwapQuote: (...) => Promise<EdgeSwapQuote>  // Heavy operations
}
```

**Benefits:**

- Static info (name, email) available immediately
- Expensive crypto libraries loaded only when needed
- Async initialization support

### 3. Request/Quote Pattern

All plugins follow the same flow:

1. **Request** (`EdgeSwapRequest`): User specifies swap parameters
2. **Quote** (`EdgeSwapQuote`): Plugin returns quote with approval function
3. **Approval**: User approves quote, triggering transaction creation

```typescript
const quote = await plugin.fetchSwapQuote(request);
const swap = await quote.approve();
```

## Plugin Categories

### Centralized Exchange (CEX) Plugins

Located in `src/swap/central/`, these plugins:

- Integrate with third-party exchange APIs
- Handle API key management
- Implement order tracking via external URLs

**Common patterns:**

- API response validation using cleaners
- Rate limiting and retry logic
- Order status polling

### Decentralized Exchange (DEX) Plugins

Located in `src/swap/defi/`, these plugins:

- Build on-chain transactions
- Calculate gas fees
- Handle smart contract interactions

**Common patterns:**

- ABI definitions for smart contracts
- Gas estimation logic
- Slippage tolerance calculations

### Protocol-Specific Implementations

Some DEXs share common protocols:

#### Uniswap V2 Based

Multiple DEXs use the Uniswap V2 protocol:

- SpookySwap (Fantom)
- TombSwap (Fantom)
- Velodrome (Optimism)

Shared code in `uni-v2-based/uniV2Utils.ts`:

- Router contract interactions
- Liquidity pool queries
- Path finding algorithms

#### Cross-Chain Protocols

- **Thorchain/Maya**: Native cross-chain swaps
- **CosmosIBC**: Inter-blockchain communication
- **LiFi/Rango**: Aggregated cross-chain routing

## Data Flow Architecture

### 1. Currency Code Translation

Edge uses unified currency codes that must be translated:

```typescript
// Edge format: 'ethereum:usdc'
// Exchange format: 'eth.usdc' or 'USDC-ETH'

const MAINNET_CODE_TRANSCRIPTION = {
  ethereum: "eth",
  bitcoin: "btc",
};
```

### 2. Amount Handling

All amounts use native units (satoshis, wei) as strings:

```typescript
// Convert display amount to native
const nativeAmount = await wallet.denominationToNative(
  displayAmount,
  currencyCode
);

// Always use strings for precision
const amount = "1000000000000000000"; // 1 ETH in wei
```

### 3. Token Identification

Edge uses `EdgeTokenId` (string | null) to identify assets:

- `null`: Native blockchain asset (ETH, BTC)
- `string`: Token contract address or identifier

```typescript
const isNative = tokenId == null;
const contractAddress =
  wallet.currencyConfig.allTokens[tokenId]?.networkLocation?.contractAddress;
```

## Error Handling Patterns

### Graceful Degradation

Plugins should fail gracefully and provide meaningful errors:

```typescript
try {
  const response = await fetch(apiUrl);
  return processResponse(response);
} catch (error) {
  if (error.message.includes("timeout")) {
    throw new SwapPermissionError(swapInfo, "Service temporarily unavailable");
  }
  throw error;
}
```

### Validation Layers

1. **Request validation**: Check supported currencies
2. **Quote validation**: Verify amounts and rates
3. **Transaction validation**: Ensure valid addresses

## Performance Patterns

### Caching

Plugins cache exchange info to reduce API calls:

```typescript
const CACHE_EXPIRATION = 60 * 1000; // 1 minute

if (Date.now() - lastUpdate > CACHE_EXPIRATION) {
  exchangeInfo = await fetchExchangeInfo();
  lastUpdate = Date.now();
}
```

### Parallel Requests

When possible, fetch data in parallel:

```typescript
const [rates, limits] = await Promise.all([fetchRates(), fetchLimits()]);
```

## Security Patterns

### API Key Management

API keys are passed through `initOptions`:

```typescript
const asInitOptions = asObject({
  apiKey: asString,
  secret: asOptional(asString),
});

const { apiKey } = asInitOptions(opts.initOptions);
```

### Input Sanitization

Always validate and sanitize external inputs:

```typescript
const cleanAddress = address.replace(/[^a-zA-Z0-9]/g, "");
if (!isValidAddress(cleanAddress)) {
  throw new Error("Invalid address format");
}
```

## Testing Patterns

### Mock Implementations

Create fake currency plugins for testing:

```typescript
const fakeBitcoinPlugin = makeFakeCurrencyPlugin({
  pluginId: "bitcoin",
  currencyCode: "BTC",
});
```

### Integration Testing

Test against real APIs with timeout protection:

```typescript
it("should fetch quote", async function () {
  this.timeout(30000); // 30 second timeout
  const quote = await plugin.fetchSwapQuote(request);
  assert(quote.fromNativeAmount > "0");
});
```
