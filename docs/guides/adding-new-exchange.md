# Adding a New Exchange Plugin

**Date**: 2025-08-20

## Overview

This guide walks through adding a new exchange plugin to edge-exchange-plugins. Exchange plugins enable Edge Wallet to perform cryptocurrency swaps through various providers.

## Prerequisites

1. Clone edge-exchange-plugins and edge-react-gui as peers:

   ```bash
   git clone git@github.com:EdgeApp/edge-exchange-plugins.git
   git clone git@github.com:EdgeApp/edge-react-gui.git
   ```

2. Build edge-exchange-plugins:

   ```bash
   cd edge-exchange-plugins
   yarn
   yarn prepare
   ```

3. Link to edge-react-gui:
   ```bash
   cd ../edge-react-gui
   yarn updot edge-exchange-plugins
   yarn prepare
   yarn prepare.ios  # For iOS development
   ```

## Implementation Steps

### 1. Choose Plugin Type

Determine if your exchange is:

- **Centralized** (API-based): Place in `src/swap/central/`
- **Decentralized** (DEX): Place in `src/swap/defi/`

### 2. Create Plugin File

Create your plugin file following the naming convention:

```typescript
// src/swap/central/myexchange.ts
import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
} from "edge-core-js/types";

const pluginId = "myexchange";

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false, // true for DEX
  displayName: "My Exchange",
  supportEmail: "support@myexchange.com",
};

export function makeMyExchangePlugin(
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin {
  // Implementation
}
```

### 3. Implement Required Methods

Your plugin must implement `fetchSwapQuote`:

```typescript
async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
  // 1. Validate supported currencies
  const { fromCurrencyCode, toCurrencyCode } = request

  // 2. Convert Edge request to your API format
  const apiRequest = await convertRequest(request)

  // 3. Call your exchange API
  const quote = await fetchQuoteFromApi(apiRequest)

  // 4. Validate limits
  if (lt(quote.fromAmount, MIN_AMOUNT)) {
    throw new SwapBelowLimitError(swapInfo, MIN_AMOUNT)
  }

  // 5. Return EdgeSwapQuote
  return makeSwapPluginQuote({
    request,
    swapInfo,
    // Your quote details
  })
}
```

### 4. Add to Index

Export your plugin in `src/index.ts`:

```typescript
import { makeMyExchangePlugin } from "./swap/central/myexchange";

const plugins = {
  // ... existing plugins
  myexchange: makeMyExchangePlugin,
};
```

### 5. Configure in edge-react-gui

1. Add logo assets:

   - 64x64 pixel square logo (white background)
   - 600x210 pixel horizontal logo (no empty space)

2. Update environment config in `env.json`

3. Search for "changelly" in edge-react-gui and make similar changes for your plugin

## Testing Your Plugin

### Local Testing

1. Disable other exchanges in Settings > Exchange Settings
2. Test swaps with your plugin enabled
3. Verify error handling for:
   - Unsupported currencies
   - Below/above limits
   - Network errors

### Test Coverage

Create tests in `test/myexchange.test.ts`:

```typescript
describe("MyExchange Plugin", () => {
  it("should fetch a valid quote", async () => {
    const plugin = makeMyExchangePlugin({ initOptions: { apiKey: "test" } });
    const quote = await plugin.fetchSwapQuote(mockRequest);
    expect(quote.fromNativeAmount).to.equal("1000000000");
  });
});
```

## Submission Requirements

Before submitting a PR:

1. **Add transaction reporting** - Submit PR to edge-reports for crediting Edge users
2. **Rebase on master** - Keep your branch up to date
3. **Include assets** - Logo files in edge-react-gui PR
4. **Test thoroughly** - All edge cases and error conditions

## Common Patterns

### Currency Code Mapping

If your API uses different currency codes:

```typescript
const currencyMap: StringMap = {
  USDT: "USDT20", // Your API code
  BTC: "BTC",
};
```

### Rate Limiting

Handle API rate limits gracefully:

```typescript
const RATE_LIMIT_MS = 1000;
let lastCallTime = 0;

async function throttledFetch() {
  const now = Date.now();
  const timeSinceLastCall = now - lastCallTime;
  if (timeSinceLastCall < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastCall)
    );
  }
  lastCallTime = Date.now();
  // Make API call
}
```

## Debugging Tips

1. **Enable your plugin only** in Exchange Settings
2. **Check logs** for API responses and errors
3. **Use test wallets** with small amounts
4. **Run local webpack server** for hot reloading:
   ```bash
   yarn start  # In edge-exchange-plugins
   ```

## Support

For questions or issues:

- Review existing plugins for examples
- Check closed PRs for similar implementations
- Contact Edge team for API access or integration support
