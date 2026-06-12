# TypeScript Style Guide

**Date**: 2025-08-20

## Import Conventions

### Always use type imports for types

```typescript
// ✅ Good
import type { EdgeSwapQuote, EdgeCurrencyWallet } from "edge-core-js/types";

// ❌ Bad
import { EdgeSwapQuote, EdgeCurrencyWallet } from "edge-core-js/types";
```

### Import sorting is enforced

- Imports are automatically sorted by `simple-import-sort` ESLint plugin
- Order: external packages first, then internal modules
- No default exports are used in this codebase

## Type Safety

### Strict TypeScript is enabled

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

### Use cleaners for runtime validation

```typescript
// Always validate external data with cleaners
import { asObject, asString, asNumber } from "cleaners";

const asApiResponse = asObject({
  rate: asNumber,
  currency: asString,
});
```

### Use biggystring for numeric operations

```typescript
// ✅ Good - use biggystring for comparisons
import { gt, lt } from "biggystring";
if (gt(amount, maxAmount)) throw new SwapAboveLimitError();

// ❌ Bad - don't use Number for crypto amounts
if (Number(amount) > Number(maxAmount)) throw new SwapAboveLimitError();
```

## Error Handling

### Throw specific Edge error types

```typescript
// ✅ Good
throw new SwapCurrencyError(swapInfo, request);
throw new SwapAboveLimitError(swapInfo, max, "from");
throw new SwapBelowLimitError(swapInfo, min, "to");
throw new SwapPermissionError(swapInfo, "geoRestriction");

// ❌ Bad
throw new Error("Invalid currency");
```

### Always handle async errors with try/catch

```typescript
async function fetchQuote(): Promise<EdgeSwapQuote> {
  try {
    const response = await fetch(url);
    return processResponse(response);
  } catch (error) {
    throw new SwapCurrencyError(swapInfo, "BTC", "ETH");
  }
}
```

## Naming Conventions

### Variables and functions: camelCase

```typescript
const swapRequest = { ... }
function calculateExchangeRate() { ... }
```

### Types and interfaces: PascalCase

```typescript
interface SwapOrder { ... }
type EdgeSwapRequestPlugin = { ... }
```

### Constants: UPPER_SNAKE_CASE

```typescript
const MAX_RETRIES = 3;
const API_BASE_URL = "https://api.exchange.com";
```

### Files: camelCase with .ts extension

- `src/swap/central/changenow.ts`
- `src/util/swapHelpers.ts`

## Code Organization

### Named exports only

```typescript
// ✅ Good
export const swapInfo = { ... }
export function makePlugin() { ... }

// ❌ Bad
export default makePlugin
```

### Extract magic numbers as constants

```typescript
// ✅ Good
const EXPIRATION_TIME_SECONDS = 600
if (Date.now() / 1000 > quote.expirationDate + EXPIRATION_TIME_SECONDS) { ... }

// ❌ Bad
if (Date.now() / 1000 > quote.expirationDate + 600) { ... }
```

## References

- ESLint config: `.eslintrc.json`
- TypeScript config: `tsconfig.json`
- Editor config: `.editorconfig`
- [Edge Development Conventions](https://github.com/EdgeApp/edge-conventions) - Company-wide conventions for all Edge projects
