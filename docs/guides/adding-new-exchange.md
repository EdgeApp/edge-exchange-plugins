# Adding a New Exchange Plugin

**Date**: 2025-08-20

## Overview

This guide walks through adding a new exchange plugin to edge-exchange-plugins. Exchange plugins enable Edge Wallet to perform cryptocurrency swaps through various providers.

## Prerequisites

### Option 1: Debug Server (Recommended for Development)

1. Clone edge-exchange-plugins and edge-react-gui as peers:

   ```bash
   git clone git@github.com:EdgeApp/edge-exchange-plugins.git
   git clone git@github.com:EdgeApp/edge-react-gui.git
   ```

2. Set up debug mode in edge-react-gui:

   ```json
   // edge-react-gui/env.json
   {
     "DEBUG_EXCHANGE": true
   }
   ```

3. Start the development server:
   ```bash
   cd edge-exchange-plugins
   yarn
   yarn start  # Runs webpack dev server on localhost:8083
   ```

This approach uses a local webpack server that hot-reloads your changes, making development faster and easier.

### Option 2: Direct Linking (For Production Testing)

1. Clone edge-exchange-plugins and edge-react-gui as peers (same as above)

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

This approach builds and links the plugins directly into edge-react-gui, which is closer to production behavior but requires rebuilding after each change.

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
  // 1. Map Edge pluginId/tokenId to your exchange's symbols
  const fromSymbol = mapToExchangeSymbol(request.fromWallet, request.fromTokenId)
  const toSymbol = mapToExchangeSymbol(request.toWallet, request.toTokenId)

  // 2. Convert Edge request to your API format
  const apiRequest = await convertRequest(request, fromSymbol, toSymbol)

  // 3. Call your exchange API for validation and quote
  const quote = await fetchQuoteFromApi(apiRequest)

  // 4. Validate based on API response (not hardcoded values)
  // The API should return supported assets, limits, and region restrictions
  if (quote.error) {
    handleApiError(quote.error, request)
  }

  // 5. Return EdgeSwapQuote
  return makeSwapPluginQuote({
    request,
    swapInfo,
    // Your quote details from API
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
   - Unsupported assets (pluginId/tokenId combinations)
   - Below/above limits from API
   - Region restrictions
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

### PluginId/TokenId to Symbol Mapping

Map Edge's pluginId and tokenId to your exchange's symbols:

```typescript
// Map Edge pluginId to your exchange's chain identifiers
const CHAIN_MAP: Record<string, string> = {
  bitcoin: "btc",
  ethereum: "eth",
  binancesmartchain: "bsc",
  avalanche: "avax",
  // Add all supported chains
};

// Helper to convert Edge wallet/tokenId to exchange symbol
function mapToExchangeSymbol(
  wallet: EdgeCurrencyWallet,
  tokenId: EdgeTokenId
): string {
  const pluginId = wallet.currencyInfo.pluginId;
  const chainSymbol = CHAIN_MAP[pluginId];

  if (tokenId == null) {
    // Native currency
    return chainSymbol;
  }

  // For tokens, you may need additional mapping
  // based on your exchange's token symbol format
  const token = wallet.currencyConfig.allTokens[tokenId];
  return mapTokenToSymbol(chainSymbol, token);
}

// For exchanges that use EVM chain IDs
const EVM_CHAIN_ID_TO_PLUGIN: Record<string, string> = {
  "1": "ethereum", // Ethereum Mainnet
  "56": "binancesmartchain", // BSC
  "137": "polygon", // Polygon
  "43114": "avalanche", // Avalanche C-Chain
  // Add other EVM chains as needed
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
4. **Use debug server** for faster development:
   - Set `DEBUG_EXCHANGE: true` in edge-react-gui's env.json
   - Run `yarn start` in edge-exchange-plugins
   - Changes will hot-reload without rebuilding

## Support

For questions or issues:

- Review existing plugins for examples
- Check closed PRs for similar implementations
- Contact Edge team for API access or integration support
