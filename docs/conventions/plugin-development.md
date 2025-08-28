# Plugin Development Conventions

## Plugin Structure

All exchange plugins follow a consistent pattern for organization and implementation.

### Directory Structure

```
src/swap/
├── central/          # Centralized exchanges (CEX)
│   ├── changenow.ts
│   ├── sideshift.ts
│   └── ...
├── defi/            # Decentralized exchanges (DEX)
│   ├── 0x/          # Protocol-specific implementations
│   ├── thorchain/
│   ├── uni-v2-based/
│   └── ...
└── types.ts         # Shared type definitions
```

### Plugin Factory Pattern

Every plugin exports a factory function that follows this naming convention:

- `make{PluginName}Plugin` (e.g., `makeChangeNowPlugin`, `makeThorchainPlugin`)

```typescript
export const makeMyExchangePlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  // Plugin implementation
};
```

### Plugin Registration

Plugins are registered in `src/index.ts`:

```typescript
const plugins = {
  myexchange: makeMyExchangePlugin,
  // ...
};
```

## Code Organization

### Imports

- External dependencies first (npm packages)
- Edge-core-js imports second
- Internal utility imports third
- Relative imports last
- Use simple-import-sort for automatic ordering

### Constants

- Plugin-specific constants at the top of the file
- Use UPPER_SNAKE_CASE for true constants
- Group related constants together

### Network/Chain Code Mapping

Most plugins require mapping between Edge currency plugin IDs and exchange-specific chain codes:

```typescript
export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  bitcoin: "btc",
  ethereum: "eth",
  // ...
};
```

## Error Handling

### Standard Swap Errors

Use Edge's built-in swap error types:

- `SwapCurrencyError` - Currency not supported
- `SwapBelowLimitError` - Amount too small
- `SwapAboveLimitError` - Amount too large
- `SwapPermissionError` - User not authorized

### Error Context

Always provide meaningful context in error messages:

```typescript
throw new SwapCurrencyError(swapInfo, {
  fromCurrency: "BTC",
  toCurrency: "INVALID",
});
```

## Type Safety

### Cleaners

Use cleaners for all external API responses:

```typescript
const asApiResponse = asObject({
  rate: asString,
  min: asNumber,
  max: asOptional(asNumber),
});
```

### EdgeTokenId Usage

Always handle both native assets (null tokenId) and tokens:

```typescript
const tokenId: EdgeTokenId = request.fromTokenId; // can be string | null
if (tokenId == null) {
  // Native asset
} else {
  // Token
}
```

## Testing Conventions

### Test File Location

- Place tests in `test/` directory
- Name test files as `{feature}.test.ts`

### Test Structure

```typescript
describe("Feature Name", function () {
  it("should do something specific", function () {
    // Test implementation
  });
});
```

### Mock Data

- Store mock data in separate files (e.g., `fake{Asset}Info.ts`)
- Use realistic test data that matches production formats

## Documentation

### Function Documentation

Use JSDoc for public APIs and complex functions:

```typescript
/**
 * Converts an Edge swap request to exchange-specific format
 * @param request - The Edge swap request
 * @returns Exchange-specific request object
 */
```

### Inline Comments

- Use sparingly for complex logic
- Explain "why" not "what"
- Keep comments up-to-date with code changes
