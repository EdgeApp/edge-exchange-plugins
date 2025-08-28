# Adding a New Exchange Plugin

This guide walks through adding a new exchange plugin to edge-exchange-plugins.

## Prerequisites

- Familiarity with TypeScript and async/await
- Understanding of the exchange's API documentation
- Access to the exchange's testnet or sandbox (if available)

## Step 1: Determine Plugin Type

### Centralized Exchange (CEX)

If your exchange:

- Requires API keys
- Manages user accounts
- Handles custody of funds
- Provides off-chain order matching

Place your plugin in `src/swap/central/`

### Decentralized Exchange (DEX)

If your exchange:

- Operates via smart contracts
- Requires on-chain transactions
- Has no custody of funds
- Uses automated market makers (AMM)

Place your plugin in `src/swap/defi/`

## Step 2: Create Plugin File

Create a new TypeScript file following the naming convention:

```
src/swap/central/myexchange.ts  // for CEX
src/swap/defi/myprotocol.ts     // for DEX
```

## Step 3: Implement Basic Structure

### For CEX Plugin:

```typescript
import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
} from "edge-core-js/types";
import { makeSwapPlugin } from "../../util/makeSwapPlugin";

const pluginId = "myexchange";

const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false,
  displayName: "My Exchange",
  supportEmail: "support@myexchange.com",
};

// Define init options if API keys are needed
const asInitOptions = asObject({
  apiKey: asString,
  secret: asOptional(asString),
});

// Map Edge currency codes to exchange codes
const MAINNET_CODE_TRANSCRIPTION = {
  bitcoin: "btc",
  ethereum: "eth",
  // Add all supported networks
};

export const makeMyExchangePlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  const initOptions = asInitOptions(opts.initOptions);

  return makeSwapPlugin({
    swapInfo,

    async getInnerPlugin() {
      return {
        async fetchSwapQuote(env, request, userSettings, opts) {
          // Implementation here
        },
      };
    },
  });
};
```

### For DEX Plugin:

DEX plugins typically need to interact with smart contracts:

```typescript
import {
  EdgeCorePluginOptions,
  EdgeSwapInfo,
  EdgeSwapPlugin,
} from "edge-core-js/types";

const swapInfo: EdgeSwapInfo = {
  pluginId: "myprotocol",
  isDex: true,
  displayName: "My Protocol",
  supportEmail: "support@edge.app",
};

// Define contract addresses
const ROUTER_ADDRESSES = {
  ethereum: "0x...",
  polygon: "0x...",
};

// Include contract ABIs
const ROUTER_ABI = [
  // Contract interface
];

export const makeMyProtocolPlugin = (
  opts: EdgeCorePluginOptions
): EdgeSwapPlugin => {
  // Implementation
};
```

## Step 4: Implement Core Functionality

### Required Methods

#### fetchSwapQuote

This is the main method that must:

1. **Validate the request**

```typescript
// Check supported currencies
checkInvalidCodes(INVALID_CURRENCY_CODES, request);

// Check if mainnet-only
checkWhitelistedMainnetCodes(MAINNET_CODE_TRANSCRIPTION, request, swapInfo);
```

2. **Convert request format**

```typescript
const convertedRequest = convertRequest(request, MAINNET_CODE_TRANSCRIPTION);
```

3. **Fetch quote from exchange**

```typescript
const response = await fetch(`${API_URL}/quote`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Api-Key": apiKey,
  },
  body: JSON.stringify({
    from: convertedRequest.fromCurrencyCode,
    to: convertedRequest.toCurrencyCode,
    amount: convertedRequest.fromAmount,
  }),
});

const quote = asQuoteResponse(await response.json());
```

4. **Return EdgeSwapQuote**

```typescript
return makeSwapPluginQuote({
  request,
  swapInfo,
  fromNativeAmount: quote.fromAmount,
  toNativeAmount: quote.toAmount,

  async approve() {
    // Create the actual swap order
    const order = await createOrder(quote.id);

    // Return transaction details
    return {
      orderId: order.id,
      spendInfo: {
        spendTargets: [
          {
            nativeAmount: quote.fromAmount,
            publicAddress: order.depositAddress,
            memo: order.memo,
          },
        ],
      },
    };
  },
});
```

## Step 5: Add Error Handling

Handle common error cases:

```typescript
// Amount too small
if (lt(request.nativeAmount, minAmount)) {
  throw new SwapBelowLimitError(swapInfo, { nativeAmount: minAmount });
}

// Amount too large
if (gt(request.nativeAmount, maxAmount)) {
  throw new SwapAboveLimitError(swapInfo, { nativeAmount: maxAmount });
}

// Unsupported currency
if (!supportedCurrencies.includes(currencyCode)) {
  throw new SwapCurrencyError(swapInfo, { currencyCode });
}
```

## Step 6: Register the Plugin

Add your plugin to `src/index.ts`:

```typescript
import { makeMyExchangePlugin } from "./swap/central/myexchange";

const plugins = {
  // ... existing plugins
  myexchange: makeMyExchangePlugin,
};
```

## Step 7: Add Tests

Create test file `test/myexchange.test.ts`:

```typescript
import { describe, it } from "mocha";
import { assert } from "chai";

describe("My Exchange Plugin", function () {
  it("should fetch a valid quote", async function () {
    this.timeout(30000);

    const plugin = makeMyExchangePlugin({
      initOptions: { apiKey: "test-key" },
      io: makeIo(),
      log: console.log,
    });

    const request = {
      // Valid test request
    };

    const quote = await plugin.fetchSwapQuote(request);
    assert(quote.fromNativeAmount > "0");
  });
});
```

## Step 8: Add Partner Data (if CEX)

For centralized exchanges, create currency mapping file:

`test/partnerJson/myexchangeMap.json`:

```json
{
  "bitcoin:BTC": "btc",
  "ethereum:ETH": "eth",
  "ethereum:USDC": "usdc"
}
```

## Step 9: Update Documentation

1. Update this plugin list in README.md
2. Add any special configuration requirements
3. Document any exchange-specific features or limitations

## Step 10: Submit Pull Request

Before submitting:

1. **Run all tests**: `npm test`
2. **Fix linting**: `npm run fix`
3. **Check types**: `npm run types`
4. **Verify build**: `npm run prepare`

### PR Requirements

Your PR must include:

1. **Exchange plugin implementation**
2. **Tests with reasonable coverage**
3. **Partner reporting integration** (for CEX)
4. **Logo assets** for edge-react-gui:
   - 64x64px square logo (white background)
   - 600x210px horizontal logo (no padding)

## Common Pitfalls

### 1. String Precision

Always use strings for amounts to avoid floating point errors:

```typescript
// Bad
const amount = 1.23456789;

// Good
const amount = "123456789";
```

### 2. Token vs Native

Always check if dealing with tokens or native assets:

```typescript
const isToken = request.fromTokenId != null;
const currencyCode = isToken
  ? wallet.currencyConfig.allTokens[request.fromTokenId].currencyCode
  : wallet.currencyInfo.currencyCode;
```

### 3. Rate Limiting

Implement proper rate limiting:

```typescript
const rateLimiter = makeRateLimiter(60, 100); // 100 requests per minute
await rateLimiter.wait();
```

### 4. Network Fees

For DEX plugins, include gas estimation:

```typescript
const gasLimit = await contract.estimateGas.swap(...)
const gasPrice = await provider.getGasPrice()
const networkFee = gasLimit.mul(gasPrice).toString()
```

## Getting Help

- Review existing plugins for examples
- Check edge-core-js documentation
- Open an issue for architectural questions
- Join Edge Discord for community support
