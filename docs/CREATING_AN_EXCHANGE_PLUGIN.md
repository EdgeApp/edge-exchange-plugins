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
2. Install: `npm install && npm run prepare`
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

Each plugin needs a mapping file in `src/mappings/` that translates Edge currency plugin IDs to your exchange provider's chain codes. **For EVM chains, use `evmChainId` (not provider-specific network names)** per API requirements.

#### Creating the Mapping File

Follow the [Chain Mapping Synchronizers](./CHAIN_MAPPING_SYNCHRONIZERS.md) guide to set up automated synchronization for your mapping file. This fetches supported chains from your provider's API and keeps the mapping up-to-date.

#### Using the Mapping in Your Plugin

Import and use the mapping directly:

```typescript
import { yourplugin as yourpluginMapping } from '../../mappings/yourplugin'

// In your quote function:
const fromMainnetCode = yourpluginMapping.get(fromWallet.currencyInfo.pluginId)
const toMainnetCode = yourpluginMapping.get(toWallet.currencyInfo.pluginId)

if (fromMainnetCode == null || toMainnetCode == null) {
  throw new SwapCurrencyError(swapInfo, request)
}
```

> **Note**: Some existing plugins convert the Map to an object using `mapToStringMap()` or `mapToRecord()` from `swapHelpers.ts`. This is a legacy pattern - new plugins can use the Map directly.

#### Manual Mapping (Alternative)

For providers without a chain configuration API, you can manually create and maintain `src/mappings/yourplugin.ts`:

```typescript
import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const yourplugin = new Map<EdgeCurrencyPluginId, string | null>()
yourplugin.set('bitcoin', 'BTC')
yourplugin.set('ethereum', 'ETH')
yourplugin.set('binancesmartchain', 'BSC')
yourplugin.set('unsupportedchain', null)  // null = not supported by provider
// ... map all Edge plugin IDs to your provider's chain codes
```

### Step 4: Quote Fetching

The `fetchSwapQuote` function must:
1. Call `checkInvalidTokenIds()` before touching the network, so blocked assets
   and same-asset self-swaps fail client-side
2. Get addresses using `getAddress()`
3. Route `max` requests through `getMaxSwappable()` (see Step 4b)
4. Call exchange API with proper error handling
5. Map API errors to Edge error types (see Step 6)
6. Create `EdgeSpendInfo` or `MakeTxParams`
7. Return quote using `makeSwapPluginQuote()`

### Step 4b: Max Quotes

A `max` request arrives carrying the wallet's **raw, pre-fee balance**.
`getMaxSwappable()` invokes your quote function as a probe with that balance,
uses the returned `spendInfo` to price network fees via `getMaxSpendable()`, and
rewrites the request as a `from` quote for the spendable remainder. Your quote
function then runs a second time with the trimmed amount.

Because the function runs twice, split quote fetching from order creation:

```typescript
// Probe: quote only, no order. Runs on the raw balance.
const fetchProbeOrder = async (request: EdgeSwapRequestPlugin): Promise<SwapOrder> => {
  const { quote, fromAddress } = await fetchQuote(request, false /* enforceMax */)
  const spendInfo: EdgeSpendInfo = {
    tokenId: request.fromTokenId,
    spendTargets: [{ nativeAmount: quote.sourceAmount, publicAddress: fromAddress }],
    networkFeeOption: 'high',
    skipChecks: true,
    assetAction: { assetActionType: 'swap' }
  }
  return { request, spendInfo, swapInfo, fromNativeAmount: quote.sourceAmount, expirationDate }
}

const newRequest = await getMaxSwappable(fetchProbeOrder, request)
const swapOrder = await fetchSwapQuoteInner(newRequest) // creates the order, once
```

Three details are load-bearing, and each has broken a shipped plugin:

- **The probe must not create an order.** Otherwise every max swap creates and
  abandons a live order, which also burns the budget of any provider that
  rate-limits order creation.
- **`skipChecks: true` on the probe's `spendInfo`.** The probe targets the
  user's own address, which EVM engines reject with `SpendToSelfError` because
  the public key *is* the address. That error escapes `getMaxSwappable` and
  fails every max swap from an EVM wallet.
- **The probe must clamp, not throw, above-limit.** It deliberately quotes the
  full pre-fee balance, so an above-limit balance must fall through to
  `getMaxSpendable`. Throwing `SwapAboveLimitError` there aborts a max swap that
  would have fit once fees were subtracted. Gate the throw on a flag the probe
  passes as `false`.

If the provider has no separate quote endpoint (order creation *is* the quote),
say so in a comment. The abandoned probe order is then inherent rather than a
plugin defect.

### Step 5: Amount Conversions

```typescript
import { denominationToNative, nativeToDenomination } from '../../util/swapHelpers'

// To API
const apiAmount = nativeToDenomination(wallet, nativeAmount, tokenId)

// From API — round to whole atomic units
const nativeAmount = floor(denominationToNative(wallet, apiAmount, tokenId), 0)
```

`denominationToNative` is a plain multiply, so a provider amount carrying more
decimals than the asset's denomination returns a **fraction**
(`mul('0.123456789', '100000000')` is `12345678.9`). Edge native amounts are
integers everywhere, so always round.

The direction matters:

| Value | Rounding | Why |
|---|---|---|
| Minimum limit | `ceil` | The enforced minimum must never fall below the provider's real floor |
| Maximum limit | `floor` | The enforced maximum must never exceed the provider's real ceiling |
| Receive amount | `floor` | Never show the user more than what actually arrives |

Do all comparison and sorting with `biggystring` too, not just arithmetic.
`String(smallFloat)` can produce scientific notation, which string comparison
misreads, and float subtraction misorders large or close values.

Never assume the provider's documented unit. Docs claiming base units while the
API returns decimals is common, and the mistake is invisible whenever the pairs
used during development return null limits.

### Step 6: Error Handling

**The API must return all applicable errors in an array.** Your plugin prioritizes which error to throw.

Four rules, each from a shipped defect:

1. **Limit errors outrank currency errors.** A limit failure whose code or
   message also names a token, path or route must still surface as
   `SwapBelowLimitError` / `SwapAboveLimitError`. `pickBestError` ranks by type,
   so misclassifying hides the real amount from the user. If the provider only
   reports free text, match whole phrases: a substring test for `LOW` also
   matches `ALLOWANCE`.
2. **Enforce limits against `request.nativeAmount`**, never against the amount
   echoed back in the quote. A provider that silently clamps an out-of-range
   request returns an in-range echo, so comparing the echo lets the swap proceed
   for less than the user asked, with the difference refunded at whatever rate
   the provider picks.
3. **A transient failure is not an unsupported pair.** A non-OK status from an
   asset or token lookup must surface as a real error. Converting it to
   `SwapCurrencyError` reports "unsupported pair" for an outage and can poison
   pair-capability caching.
4. **An unquotable mapped pair *is* a currency error.** Throw
   `SwapCurrencyError` so the GUI omits this provider, rather than a plain
   `Error` that surfaces as a hard failure. Provider network codes go stale, so
   mapped-but-unquotable is a steady state, not an edge case.

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

Three fields above are decisions, not boilerplate:

- **`orderUri` is built from your own constant** plus the order id. Never persist
  a partner-supplied `statusUrl`. It renders as a tappable link in the
  transaction details, so accepting its host and scheme lets a compromised
  upstream steer users anywhere.
- **`isEstimate` reports what the provider actually guarantees.** Hardcoding
  `false` shows the user a locked receive amount on a floating route, so a
  market-moving leg silently delivers less than the quote promised.
- **`expirationDate` goes through `ensureInFuture()`.** A provider `validUntil`
  can already be in the past from clock skew, which fails the quote at approval.

#### Bound provider amounts before signing

`fromNativeAmount` comes from the provider's response and is about to become a
signed spend, so bound it by what the user requested:

```typescript
if (request.quoteFor === 'from' && gt(fromNativeAmount, request.nativeAmount)) {
  throw new Error('Provider returned a source amount above the requested amount')
}
```

Bound **every** field the spend path consumes, not only the most obvious one: on
a DeFi route that includes the token-approval amount and any native value on the
transaction. Compare each against a value in **its own units** — a native fee in
wei compared against a token amount in token base units falsely rejects valid
quotes.

Only a `from` quote pins the source amount locally. On a reverse (`to`) quote the
user pinned the receive amount, so there is nothing local to bound against.

### Step 8: API Response Validation

Always use `cleaners` to validate API responses:

Keep the **quote** and **order** responses as separate cleaners. What belongs to
which is not cosmetic: a response carrying a `depositAddress` has committed the
provider, so if `orderId` and `depositAddress` live on the quote cleaner then the
quote call *is* an order call, and the max probe cannot avoid creating one no
matter how the code is arranged.

```typescript
import { asObject, asString, asNumberString, asDate, asOptional } from 'cleaners'
import { asOptionalBlank } from './changenow'

// Quote step: prices the swap, commits to nothing.
const asQuoteResponse = asObject({
  quoteId: asString,
  sourceAmount: asNumberString,
  destinationAmount: asNumberString,
  expirationIsoDate: asDate
})

// Order step: the only call that commits. Made once per swap.
const asOrderResponse = asObject({
  orderId: asString,
  depositAddress: asString,
  depositExtraId: asOptionalBlank(asNumberString),
  sourceAmount: asNumberString,
  destinationAmount: asNumberString
})
```

If the provider offers only one endpoint that both prices and commits, say so in
a comment. The abandoned probe order is then inherent to the provider rather than
a defect in the plugin, and reviewers have accepted that where it is true.

**Memo cleaning is a funds-safety decision.** `asOptional(asString)` (or
`asMaybe(asString)`) has two failure modes that both silently send an *untagged*
deposit, which loses funds on memo-based chains:

- a **numeric** memo — the common shape for an XRP destination tag, including
  the valid tag `0` — fails a string-only cleaner
- an **empty string** becomes an empty `EdgeMemo` rather than no memo at all

`asOptionalBlank(asNumberString)` covers both.

Two more cleaner notes:

- Accept **numeric or string error codes**. A provider that returns amounts as
  either shape usually does the same with codes, and `asNumberString`
  normalizes them, so classification does not depend on which arrived.
- `asOptional` in this repo's `cleaners` version already maps a JSON `null` to
  `undefined`. `asEither(asString, asNull)` is only needed when `null` and
  absent must stay distinguishable.

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

1. Build: `npm run prepare`
2. In `edge-react-gui`: `npm run updot edge-exchange-plugins && npm run prepare`
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

Swap plugins execute inside `edge-core-js`'s plugin WebView, not the React
Native JS context, so Metro's debugger and Hermes breakpoints cannot reach them.
Verification means rebuilding the bundle, relinking, and reading plugin logs.
Budget for that loop.

**Exercise these paths specifically**, since they are where new plugins break
and none of them show up in a happy-path quote:

- A **max** swap from an EVM wallet (catches a probe missing `skipChecks`)
- A **max** swap from a wallet whose balance exceeds the provider maximum
  (catches a probe that throws instead of clamping)
- A **reverse** (`to`) quote, if the provider supports one
- A swap to a **memo-based** chain such as XRP or XLM (catches a memo cleaner
  that drops numeric tags)
- An amount **below the minimum** and one **above the maximum**, checking the
  figure the GUI actually shows
- A **token** route, not only the native asset
- A **pair the provider does not route**, confirming it fails as
  `SwapCurrencyError` rather than a hard error

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
- [`CHAIN_MAPPING_SYNCHRONIZERS.md`](./CHAIN_MAPPING_SYNCHRONIZERS.md) - Automated mapping synchronization
- [`edge-conventions`](https://github.com/EdgeApp/edge-conventions) - Code style, setup, git conventions

**Examples**:
- `src/swap/central/template.ts` - Complete template. Its comments carry the
  reasoning behind each construct; keep them for the parts you keep
- `src/swap/central/nym.ts` - Closest reviewed central reference
- `src/swap/central/changenow.ts` - Production central exchange
- `src/swap/defi/lifi.ts` - Production DeFi exchange

**Utilities** (`src/util/`):
- `swapHelpers.ts` - `makeSwapPluginQuote`, etc.
- `utils.ts` - `getAddress`, `denominationToNative`, etc.
- `edgeCurrencyPluginIds.ts` - Currency plugin ID constants

**Chain Mappings**:
- `src/mappings/` - Chain code mapping files (Edge plugin IDs → provider codes)
- See [Chain Mapping Synchronizers](./CHAIN_MAPPING_SYNCHRONIZERS.md) for automated sync setup

**PR Requirements**:
1. Rebase on master
2. `npm run verify` passes (prepare, lint, tsc, mocha)
3. Submit PRs to `edge-reports-server` (reporting) and `edge-react-gui` (UI/logos)
4. Update docs if new patterns discovered

## Pre-PR Checklist

Every item below has been raised in review on a recent provider integration.
Walking the list before opening the PR is cheaper than discovering them one
round trip at a time. See [`.cursor/BUGBOT.md`](../.cursor/BUGBOT.md) for the
same conventions phrased as review rules.

**Amounts**

- [ ] Every `denominationToNative` result is rounded to whole atomic units
- [ ] Minimums round up; maximums and receive amounts round down
- [ ] All comparison, sorting and arithmetic goes through `biggystring`, never
      JS numbers or `String(float)`
- [ ] The provider's amount units were confirmed against a **live response**,
      not just its docs
- [ ] `Number(...)` is not used to convert a high-precision amount string

**Max quotes**

- [ ] `getMaxSwappable` is wired in
- [ ] The probe creates no order, or a comment explains why the provider makes
      that impossible
- [ ] The probe's `spendInfo` sets `skipChecks: true`
- [ ] The probe clamps rather than throwing `SwapAboveLimitError`

**Errors**

- [ ] Limit errors are ranked above currency errors
- [ ] Limits are enforced against `request.nativeAmount`, not the echoed amount
- [ ] A provider outage surfaces as a real error, not `SwapCurrencyError`
- [ ] An unquotable mapped pair surfaces as `SwapCurrencyError`, not a plain
      `Error`
- [ ] The message the user ends up seeing was actually checked, including any
      nested `fields.*.message`
- [ ] A retry backoff never truncates the provider's own `retryAfter`, and never
      sleeps past the quote's expiry

**Trust boundary**

- [ ] Every provider amount that becomes a signed spend or approval is bounded
      by the requested amount, each in its own units
- [ ] `orderUri` is built from a plugin constant, never a partner-supplied URL

**Cleaners**

- [ ] Memos use `asOptionalBlank(asNumberString)`, so numeric tags and empty
      strings are both handled
- [ ] Error codes accept numeric or string shapes
- [ ] Every API response is cleaned, and a cleaner failure logs the payload

**Structure**

- [ ] `checkInvalidTokenIds()` is called
- [ ] `isEstimate` reflects whether the rate is actually fixed
- [ ] Expiration dates go through `ensureInFuture()`
- [ ] Catch bindings are typed `(error: unknown)`
- [ ] No unauthenticated endpoint is being sent an API key, and no authenticated
      one is missing it
- [ ] Asset or chain lists are fetched lazily inside `fetchSwapQuote`, not at
      plugin construction

**Mappings**

- [ ] EVM chains use `evmChainId`, not provider network names
- [ ] Chains the provider does not support are explicitly `null`, not absent
- [ ] Any non-obvious entry carries a comment with the live evidence behind it
      (chain id reuse across EVM and non-EVM chains, and one ticker covering two
      networks, are both common and both look like bugs without that note)
- [ ] Every mapped chain's native asset actually exists in the provider's list
