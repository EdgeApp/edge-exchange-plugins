# API Integration Reference

## Edge Core Integration

Edge Exchange Plugins integrates with edge-core-js through standardized interfaces.

### Core Types

#### EdgeSwapRequest

```typescript
interface EdgeSwapRequest {
  fromWallet: EdgeCurrencyWallet;
  toWallet: EdgeCurrencyWallet;
  fromTokenId?: string | null;
  toTokenId?: string | null;
  nativeAmount: string;
  quoteFor: "from" | "max" | "to";
}
```

#### EdgeSwapQuote

```typescript
interface EdgeSwapQuote {
  swapInfo: EdgeSwapInfo;
  request: EdgeSwapRequest;
  fromNativeAmount: string;
  toNativeAmount: string;
  networkFee: {
    currencyCode: string;
    nativeAmount: string;
  };
  approve: () => Promise<EdgeSwapResult>;
}
```

#### EdgeSwapInfo

```typescript
interface EdgeSwapInfo {
  pluginId: string;
  displayName: string;
  isDex: boolean;
  supportEmail: string;
}
```

### Plugin Initialization

Plugins receive configuration through `EdgeCorePluginOptions`:

```typescript
interface EdgeCorePluginOptions {
  initOptions: any; // Plugin-specific configuration
  io: {
    fetch: typeof fetch;
    fetchCors: typeof fetch; // Deprecated, use fetch
  };
  log: (...args: any[]) => void;
}
```

## Utility Functions

### Currency Code Translation

#### convertRequest

Converts Edge request to plugin-specific format:

```typescript
import { convertRequest } from "../../util/utils";

const converted = convertRequest(request, MAINNET_CODE_TRANSCRIPTION);
// Returns: { fromCurrencyCode, toCurrencyCode, ... }
```

#### getAddress

Extracts address from wallet:

```typescript
import { getAddress } from "../../util/utils";

const address = await getAddress(wallet);
```

### Amount Handling

#### Native to Display

```typescript
const displayAmount = await wallet.nativeToDenomination(
  nativeAmount,
  currencyCode
);
```

#### Display to Native

```typescript
const nativeAmount = await wallet.denominationToNative(
  displayAmount,
  currencyCode
);
```

### Error Helpers

#### checkInvalidCodes

Validates currency support:

```typescript
import { checkInvalidCodes } from "../../util/swapHelpers";

const INVALID_CODES = {
  from: { bitcoin: ["BTC"] },
  to: { ethereum: ["ETH"] },
};

checkInvalidCodes(INVALID_CODES, request);
```

#### makeSwapPluginQuote

Creates standardized quote:

```typescript
import { makeSwapPluginQuote } from "../../util/swapHelpers";

return makeSwapPluginQuote({
  request,
  swapInfo,
  fromNativeAmount,
  toNativeAmount,
  networkFee,
  approve: async () => {
    /* ... */
  },
});
```

## API Response Validation

### Using Cleaners

Always validate external API responses:

```typescript
import { asObject, asString, asNumber } from "cleaners";

const asApiQuote = asObject({
  id: asString,
  rate: asNumber,
  fromAmount: asString,
  toAmount: asString,
  depositAddress: asOptional(asString),
  memo: asOptional(asString),
});

// Usage
try {
  const quote = asApiQuote(apiResponse);
} catch (error) {
  throw new Error(`Invalid API response: ${error.message}`);
}
```

### Common Cleaner Patterns

```typescript
// Flexible number/string handling
const asNumberString = (raw: any): string => {
  const n = asEither(asString, asNumber)(raw);
  return n.toString();
};

// Optional with default
const asStatus = asOptional(asString, "pending");

// Nested objects
const asOrderResponse = asObject({
  order: asObject({
    id: asString,
    status: asString,
    created: asDate,
  }),
  payment: asObject({
    address: asString,
    amount: asNumberString,
  }),
});
```

## DEX-Specific Patterns

### Smart Contract Interaction

#### Using ethers.js

```typescript
import { ethers } from "ethers";

const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const contract = new ethers.Contract(contractAddress, abi, provider);

// Read contract
const reserves = await contract.getReserves();

// Estimate gas
const gasLimit = await contract.estimateGas.swap(
  amountIn,
  amountOutMin,
  path,
  to,
  deadline
);

// Build transaction
const tx = await contract.populateTransaction.swap(
  amountIn,
  amountOutMin,
  path,
  to,
  deadline
);
```

#### Transaction Building

```typescript
const makeTxParams: MakeTxParams = {
  type: "MakeTxDexSwap",
  assetAction,
  savedAction,
  fromTokenId,
  fromNativeAmount,
  toTokenId,
  toNativeAmount,
  expiration: Math.floor(Date.now() / 1000) + 900, // 15 minutes
};

const tx = await fromWallet.otherMethods.makeTx(makeTxParams);
```

### Gas Estimation

```typescript
// Get current gas price
const gasPrice = await provider.getGasPrice();

// Add buffer for safety
const gasPriceWithBuffer = gasPrice.mul(110).div(100); // 10% buffer

// Calculate network fee
const networkFee = gasLimit.mul(gasPriceWithBuffer);

// Convert to native amount string
const networkFeeNative = networkFee.toString();
```

## CEX-Specific Patterns

### API Authentication

#### Header-based Auth

```typescript
const headers = {
  "X-API-KEY": apiKey,
  "X-API-SECRET": secret,
  "Content-Type": "application/json",
};
```

#### Signature-based Auth

```typescript
import { createHmac } from "crypto";

const timestamp = Date.now();
const message = `${timestamp}${method}${path}${body}`;
const signature = createHmac("sha256", secret).update(message).digest("hex");

const headers = {
  "X-SIGNATURE": signature,
  "X-TIMESTAMP": timestamp.toString(),
};
```

### Order Management

#### Creating Orders

```typescript
const order = await fetch(`${API_URL}/orders`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    from: fromCurrency,
    to: toCurrency,
    amount: amount,
    address: toAddress,
  }),
});

const orderData = asOrderResponse(await order.json());
```

#### Tracking Orders

```typescript
const orderStatus = await fetch(`${API_URL}/orders/${orderId}`, {
  headers,
});

const status = asStatusResponse(await orderStatus.json());

// Generate tracking URL
const trackingUrl = `https://exchange.com/order/${orderId}`;
```

## Rate Limiting

### Simple Rate Limiter

```typescript
class RateLimiter {
  private lastCall = 0;
  private minInterval: number;

  constructor(requestsPerSecond: number) {
    this.minInterval = 1000 / requestsPerSecond;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    if (timeSinceLastCall < this.minInterval) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minInterval - timeSinceLastCall)
      );
    }
    this.lastCall = Date.now();
  }
}

// Usage
const limiter = new RateLimiter(2); // 2 requests per second
await limiter.wait();
const response = await fetch(url);
```

## Caching Strategies

### Time-based Cache

```typescript
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class SimpleCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number;

  constructor(ttlSeconds: number) {
    this.ttl = ttlSeconds * 1000;
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }
}
```

## Testing Utilities

### Mock Wallet Creation

```typescript
import { makeFakeEdges } from "../test/fakeEdges";

const fakeEdges = makeFakeEdges();
const wallet = await fakeEdges.createCurrencyWallet({
  type: "wallet:bitcoin",
  keys: { privateKey: "mock-key" },
});
```

### Test Data Fixtures

```typescript
export const TEST_REQUEST: EdgeSwapRequest = {
  fromWallet: mockBtcWallet,
  toWallet: mockEthWallet,
  fromTokenId: null,
  toTokenId: null,
  nativeAmount: "100000000", // 1 BTC
  quoteFor: "from",
};
```
