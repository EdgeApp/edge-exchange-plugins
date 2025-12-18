# Creating an Exchange Plugin

This guide walks you through creating a new exchange plugin for Edge. **Before starting, review [`API_REQUIREMENTS.md`](./API_REQUIREMENTS.md)** which outlines mandatory API specifications.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Plugin Types](#plugin-types)
- [Getting Started](#getting-started)
- [Implementation Steps](#implementation-steps)
- [Code Conventions](#code-conventions)
- [Testing & Registration](#testing--registration)
- [Resources](#resources)

## Prerequisites

**Review [`API_REQUIREMENTS.md`](./API_REQUIREMENTS.md)** to ensure your exchange provider meets all requirements including: chain/token identification, error handling, bi-directional quoting, transaction status APIs, and reporting APIs.

### Development Environment

1. Clone `edge-exchange-plugins` as a peer to `edge-react-gui`
2. Install: `yarn && yarn prepare`
3. Review `src/swap/central/template.ts` as a complete example

## Plugin Types

**Centralized Exchange Plugins** (`src/swap/central/`): Traditional exchanges (ChangeNOW, Exolix, etc.) that handle swaps through their infrastructure. Use API keys, deposit addresses, and order IDs.

**DeFi Exchange Plugins** (`src/swap/defi/`): Decentralized exchanges (LI.FI, THORChain, etc.) that execute on-chain. May require token approvals and handle on-chain transaction construction.

## Getting Started

1. Choose location: `src/swap/central/yourplugin.ts` or `src/swap/defi/yourplugin.ts`
2. Copy `src/swap/central/template.ts` as your base
3. Study similar plugins: `exolix.ts` (central) or `lifi.ts` (DeFi)

## Implementation Steps

### Step 1: Plugin Metadata

```typescript
const pluginId = 'yourplugin'

export const swapInfo: EdgeSwapInfo = {
  pluginId,
  isDex: false, // true for DeFi plugins
  displayName: 'Your Exchange',
  supportEmail: 'support@yourexchange.com'
}
```

### Step 2: Initialization Options

```typescript
import { asObject, asOptional, asString } from 'cleaners'

const asInitOptions = asObject({
  apiKey: asString,
  affiliateId: asOptional(asString)
})
```

### Step 3: Chain Code Mapping

Map Edge currency plugin IDs to your exchange's chain codes. **For EVM chains, use `evmChainId` (not provider-specific network names)** per API requirements.

```typescript
import { CurrencyPluginIdSwapChainCodeMap } from '../../util/swapHelpers'

export const MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap = {
  bitcoin: 'BTC',
  ethereum: 'ERC20',
  binancesmartchain: 'BEP20',
  // ... map all supported chains (use null for unsupported)
}
```

### Step 4: Quote Fetching

The `fetchSwapQuote` function must:
1. Get addresses using `getAddress()`
2. Support `from`, `to`, and `max` quote directions
3. Call exchange API with proper error handling
4. Map API errors to Edge error types (see Step 6)
5. Create `EdgeSpendInfo` or `MakeTxParams`
6. Return quote using `makeSwapPluginQuote()`

### Step 5: Amount Conversions

```typescript
import { denominationToNative, nativeToDenomination } from '../../util/utils'

// To API
const apiAmount = nativeToDenomination(wallet, nativeAmount, tokenId)

// From API
const nativeAmount = denominationToNative(wallet, apiAmount, tokenId)
```

### Step 6: Error Handling

**The API must return all applicable errors in an array.** Your plugin prioritizes which error to throw.

Define cleaners:

```typescript
import { asArray, asBoolean, asEither, asNumberString, asObject, asString, asValue } from 'cleaners'

const asLimitError = asObject({
  code: asValue('BELOW_LIMIT', 'ABOVE_LIMIT'),
  message: asString,
  sourceLimitAmount: asNumberString,
  destinationLimitAmount: asNumberString
})

const asRegionError = asObject({ code: asValue('REGION_UNSUPPORTED'), message: asString })
const asCurrencyError = asObject({
  code: asValue('CURRENCY_UNSUPPORTED'),
  message: asString,
  sourceCurrencyUnsupported: asBoolean,
  destinationCurrencyUnsupported: asBoolean
})

const asErrorResponse = asObject({
  errors: asArray(asEither(asLimitError, asRegionError, asCurrencyError))
})
```

Handle errors in priority order:

```typescript
import { SwapAboveLimitError, SwapBelowLimitError, SwapCurrencyError, SwapPermissionError } from 'edge-core-js/types'

if ('errors' in quoteReply) {
  // Throw errors in order of highest priority
  // 1. Region unsupported
  // 2. Currency unsupported
  // 3. Below/Above limit
  const errors = quoteReply.errors

  // 1. Region (highest priority)
  if (errors.find(e => e.code === 'REGION_UNSUPPORTED')) {
    throw new SwapPermissionError(swapInfo, 'geoRestriction')
  }

  // 2. Currency
  if (errors.find(e => e.code === 'CURRENCY_UNSUPPORTED')) {
    throw new SwapCurrencyError(swapInfo, request)
  }

  // 3. Limits
  const limitError = errors.find(e => e.code === 'BELOW_LIMIT' || e.code === 'ABOVE_LIMIT')
  if (limitError && 'sourceLimitAmount' in limitError) {
    if (quoteFor === 'max') throw new Error('Max quote cannot return limit error')
    const nativeLimit = denominationToNative(
      quoteFor === 'from' ? request.fromWallet : request.toWallet,
      quoteFor === 'from' ? limitError.sourceLimitAmount : limitError.destinationLimitAmount,
      quoteFor === 'from' ? request.fromTokenId : request.toTokenId
    )
    throw limitError.code === 'BELOW_LIMIT'
      ? new SwapBelowLimitError(swapInfo, nativeLimit, quoteFor)
      : new SwapAboveLimitError(swapInfo, nativeLimit, quoteFor)
  }

  throw new Error('Unknown error type')
}
```

### Step 7: Transaction Information

For central exchanges, create `EdgeSpendInfo`:

```typescript
const spendInfo: EdgeSpendInfo = {
  tokenId: request.fromTokenId,
  spendTargets: [{ nativeAmount: fromNativeAmount, publicAddress: depositAddress }],
  memos: [], // Required for XRP, Stellar, etc.
  networkFeeOption: 'high',
  assetAction: { assetActionType: 'swap' },
  savedAction: {
    actionType: 'swap',
    swapInfo,
    orderId: quote.orderId,
    orderUri: orderUri + quote.orderId,
    isEstimate: false,
    toAsset: { pluginId: toWallet.currencyInfo.pluginId, tokenId: request.toTokenId, nativeAmount: toNativeAmount },
    fromAsset: { pluginId: fromWallet.currencyInfo.pluginId, tokenId: request.fromTokenId, nativeAmount: fromNativeAmount },
    payoutAddress: toAddress,
    payoutWalletId: toWallet.id,
    refundAddress: fromAddress
  }
}
```

For DeFi exchanges, use `MakeTxParams` (see DeFi plugin examples).

### Step 8: API Response Validation

Always use `cleaners` to validate API responses:

```typescript
import { asObject, asString, asNumberString, asDate, asOptional } from 'cleaners'

const asQuoteResponse = asObject({
  sourceAmount: asNumberString,
  destinationAmount: asNumberString,
  depositAddress: asString,
  orderId: asString,
  expirationIsoDate: asDate,
  depositExtraId: asOptional(asString)
})
```

## Code Conventions

Follow Edge conventions:
- **Code style**: [`edge-conventions/code/javascriptCode.md`](https://github.com/EdgeApp/edge-conventions/blob/master/code/javascriptCode.md) - Use `TODO + initials`, named exports only, Prettier formatting
- **Setup**: [`edge-conventions/code/javascriptSetup.md`](https://github.com/EdgeApp/edge-conventions/blob/master/code/javascriptSetup.md)
- **Git**: [`edge-conventions/git/commit.md`](https://github.com/EdgeApp/edge-conventions/blob/master/git/commit.md) - Imperative mood, 50 char subject, wrap body at 72 chars

**Import sorting**: Auto-sorted via `simple-import-sort` (external → Edge core → local utils → local types)

**Type safety**: Strict TypeScript, use `cleaners` for runtime validation, no `any` types

**Error handling**: Always use Edge error types (`SwapCurrencyError`, etc.), never raw strings

## Testing & Registration

### Testing

1. Build: `yarn prepare`
2. In `edge-react-gui`: `yarn updot edge-exchange-plugins && yarn prepare`
3. Enable in `edge-react-gui/env.json`:
   ```json
   {
     "YOURPLUGIN_INIT": {
       "apiKey": "your-api-key-here"
     }
   }
   ```
   Key must be uppercase with `_INIT` suffix (e.g., `GODEX_INIT`).
4. Test: Settings > Exchange Settings (disable others) > Exchange tab

**Checklist**: Builds without errors, appears in settings, quotes work, error handling works, transactions can be created/signed, order status trackable, all chains mapped

### Registration

Register in `src/index.ts`:

```typescript
import { makeYourPlugin } from './swap/central/yourplugin'

const plugins = {
  // ... existing plugins
  yourplugin: makeYourPlugin
}
```

Plugin ID must match your `pluginId` constant.

## Resources

**Documentation**:
- [`API_REQUIREMENTS.md`](./API_REQUIREMENTS.md) - Mandatory API requirements
- [`edge-conventions`](https://github.com/EdgeApp/edge-conventions) - Code style, setup, git conventions

**Examples**:
- `src/swap/central/template.ts` - Complete template
- `src/swap/central/changenow.ts` - Production central exchange
- `src/swap/defi/lifi.ts` - Production DeFi exchange

**Utilities** (`src/util/`):
- `swapHelpers.ts` - `makeSwapPluginQuote`, `getContractAddresses`, etc.
- `utils.ts` - `getAddress`, `denominationToNative`, etc.
- `edgeCurrencyPluginIds.ts` - Currency plugin ID constants

**PR Requirements**:
1. Rebase on master
2. Submit PRs to `edge-reports-server` (reporting) and `edge-react-gui` (UI/logos)
3. Update docs if new patterns discovered
4. All linting/type checking passes

**Common Pitfalls**:
- Missing chain mappings in `MAINNET_CODE_TRANSCRIPTION`
- Incorrect amount conversions (use `nativeToDenomination`/`denominationToNative`)
- Missing error handling (all types from API_REQUIREMENTS.md)
- EVM chains: use `evmChainId`, not provider network names
- Memos required for XRP, Stellar
- Quote expiration dates must be in future
