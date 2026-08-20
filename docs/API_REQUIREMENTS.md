# Edge Exchange Provider API Requirements

Technical API requirements for third-party exchange providers integrating with the Edge wallet platform, covering **crypto-to-crypto swap providers** and **fiat on/off ramp providers**.

These requirements exist to enable smooth integration across three Edge repositories:

- **[edge-exchange-plugins](https://github.com/AirshipApp/edge-exchange-plugins)**: swap plugins that call the provider API and map responses to Edge core types (`EdgeSwapQuote`, `EdgeTxActionSwap`, etc.)
- **[edge-react-gui](https://github.com/AirshipApp/edge-react-gui)**: the wallet UI that displays quotes, errors, transaction details, and opens provider status pages
- **[edge-reports-server](https://github.com/AirshipApp/edge-reports-server)**: the reporting pipeline that queries provider APIs and normalizes transactions into `StandardTx` records for revenue analytics

Field names and JSON shapes in this document are illustrative. The plugin layer maps between provider-specific names and Edge types, so the requirement is on the **information**, which must be present and machine-readable.

**All requirements are mandatory** unless explicitly stated otherwise.

### Table of contents

**General principles:**

- [Amount representation](#amount-representation)

**Requirements for all providers:**

1. [Chain and token identification](#1-chain-and-token-identification)
2. [Order identification and status page](#2-order-identification-and-status-page)
3. [Error handling](#3-error-handling)
4. [Quoting requirements](#4-quoting-requirements)
5. [Transaction status API](#5-transaction-status-api)
6. [Reporting API](#6-reporting-api)
7. [Account activation](#7-account-activation)
8. [Affiliate revenue withdrawal](#8-affiliate-revenue-withdrawal)

**Additional requirements for fiat on/off ramp providers:**

9. [User authentication](#9-user-authentication)
10. [Regional and fiat currency support](#10-regional-and-fiat-currency-support)
11. [KYC information](#11-kyc-information)
12. [Bank information](#12-bank-information)
13. [Verification](#13-verification)
14. [Widget Return URIs](#14-widgets)
15. [Off-ramp flow](#15-off-ramp-flow)

---

## General principles

### Amount representation

Amounts **should** be expressed in the asset's **native (smallest indivisible) units** rather than display units:

| Asset | Native unit | Example: 1.5 display units |
|---|---|---|
| BTC | satoshis | `150000000` |
| ETH | wei | `1500000000000000000` |
| SOL | lamports | `1500000000` |
| USDC (6 decimals) | micro-units | `1500000` |

This applies to **every** amount field in this document: quoted amounts (section 4), limit amounts in error responses (section 3), and transaction amounts in reporting records (section 6). No section carries a different convention.

Native amounts for high-decimal assets run past the IEEE-754 safe integer range (1 ETH is `1000000000000000000` wei, well beyond 2^53), so they **should** be sent as JSON **strings** rather than numbers.

Edge swap plugins convert between native and display units using `denominationToNative` / `nativeToDenomination` (see [`CREATING_AN_EXCHANGE_PLUGIN.md`](./CREATING_AN_EXCHANGE_PLUGIN.md) Step 5), so display-unit APIs are workable. If native units are not used, the API **must** clearly document which unit convention applies to every amount field so the plugin can convert correctly.

Every example in this document annotates its native amounts with the display equivalent in a trailing comment. The comments are documentation, not part of the payload.

---

## Requirements for all providers

### 1. Chain and token identification

The API **must** accept a unique chain identifier and token identifier (such as the contract address) when requesting quotes and creating orders. It is **not** sufficient to only provide a separate "list all assets" endpoint: the exact asset must be specifiable in the quote/order request itself.

Edge exchange plugins maintain a mapping file (`src/mappings/<provider>.ts`) that translates Edge `pluginId` values (e.g. `'ethereum'`, `'bitcoin'`, `'solana'`) to the provider's chain codes. The provider's identifiers do not need to match Edge's, but they must be stable and unique per chain.

For EVM chains, the API **must** accept the standard numeric EVM `chainId` (e.g. `1` for Ethereum, `56` for BNB Smart Chain). Numeric chain ids let a newly listed EVM work the day it is added, with no new entry in the plugin's mapping file, and they avoid ambiguity with provider-specific EVM network names.

For tokens, the API **must** accept the on-chain contract address (or equivalent identifier) to distinguish tokens on the same chain.

**Example: non-EVM asset**

```json
{
  "network": "solana",
  "contractAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC
}
```

**Example: EVM asset**

```json
{
  "network": "bsc",
  "evmChainId": 56, // BNB Smart Chain
  "contractAddress": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" // USDC
}
```

### 2. Order identification and status page

- Every order/quote response **must** include a unique order identifier that the plugin can store as `orderId` on the `EdgeTxActionSwap` (swap) or `EdgeTxActionFiat` (fiat) saved with the transaction. This same identifier must be usable to query the Transaction Status API (section 5) via an **unauthenticated** endpoint, and must match records in the Reporting API (section 6).
- The provider **must** host an unauthenticated, user-facing status page accessible by order identifier. The Edge GUI opens this URL (stored as `orderUri` on the transaction action) so users can track their order outside the app. Example: `https://provider.com/status/{orderId}`

### 3. Error handling

When a quote request fails or has issues, the API **must** return **all** applicable errors in a **single response** as structured JSON with machine-readable error codes. The exchange plugin determines error priority and maps to the appropriate Edge error class. Returning only a human-readable string message is not acceptable.

#### Required error types

The plugin maps provider errors to these Edge error classes (defined in `edge-core-js`):

| Scenario | Edge error class | Key data the plugin needs from the API |
|---|---|---|
| Region restricted | `SwapPermissionError` (reason: `'geoRestriction'`) | A machine-readable code indicating the restriction |
| Asset/pair not supported | `SwapCurrencyError` | A machine-readable code identifying which asset(s) are unsupported |
| Amount too low | `SwapBelowLimitError` | The minimum amount in **both** the source asset and the destination asset |
| Amount too high | `SwapAboveLimitError` | The maximum amount in **both** the source asset and the destination asset |

#### Why both source and destination limits are needed

Edge supports bi-directional quoting, so the user may be specifying either the source amount or the destination amount (`quoteFor: 'from' | 'to'`). The plugin selects the appropriate limit based on which side the user specified:

```typescript
const limitAmount =
  quoteFor === 'from'
    ? limitError.sourceLimitAmount
    : limitError.destinationLimitAmount
```

If the API can only return one side, the plugin cannot display the correct limit when the user quotes from the other direction.

#### Example structured error response

A BTC to USDT quote that is both above the limit and region restricted. Both
errors come back in the one response, and both limit fields carry the same cap
expressed in each asset.

```json
{
  "errors": [
    {
      "code": "ABOVE_LIMIT",
      "sourceLimitAmount": "978900000", // 9.789 BTC in satoshis
      "destinationLimitAmount": "1000000000000" // 1,000,000 USDT in micro-units
    },
    {
      "code": "REGION_UNSUPPORTED"
    }
  ]
}
```

Limit amounts **should** use [native units](#amount-representation), the same as every other amount in this document. Native units are integers, so a limit expressed in them always lands on a whole atomic unit, which is what Edge's limit errors carry. A display-unit limit carrying more decimal places than the asset's denomination holds does not: the plugin multiplies it up, gets a fractional native value, and has to pick a rounding direction for a bound it did not set. If the API returns limits in display units, it **must** document that convention, as [Amount Representation](#amount-representation) requires for every amount field, and the plugin converts with `denominationToNative`.

The exact field names and code strings can vary, since the plugin defines cleaners for the provider's specific format. The requirements are:
1. All errors are returned at once (not just the first one)
2. Error types are machine-readable codes (not embedded in human-readable messages)
3. Limit errors include amounts for both sides of the trade
4. The unit convention for limit amounts is documented and consistent

**Incorrect, an unstructured string message:**

```json
{
  "error": "Amount is below the minimum of 0.0001 BTC"
}
```

The defect there is the shape, not the amount. A limit buried in a human-readable sentence cannot be parsed into a `SwapBelowLimitError` at all, whichever units it is written in.

### 4. Quoting requirements

The API **must** support bi-directional quoting: the user can specify either the source amount or the destination amount, and the API returns the corresponding counterpart. In Edge, this maps to `EdgeSwapRequest.quoteFor: 'from' | 'to' | 'max'`.

The API **should** also support a "max" quote where the user wants to swap their entire balance. If the API does not support this natively, the plugin will emulate it by querying the user's balance and requesting a `'from'` quote with that amount.

Quoted amounts **should** use [native units](#amount-representation), the same as every other amount in this document. If the API quotes in display units, it **must** document that convention (see [Amount representation](#amount-representation)) so the plugin converts correctly.

#### Rate types

Where the provider offers more than one rate type (fixed, floating), the API **must** expose which types a given route supports, so the client selects a type rather than attempting one and inferring support from the failure. Where only one type is available for a route, the quote response **must** state which.

Inferring support from a failure is unreliable in both directions: a provider that answers `5xx` for a route it cannot fix is indistinguishable from an outage, and a provider that accepts an unrecognized rate-type value silently downgrades every quote.

### 5. Transaction status API

The provider **must** expose an **unauthenticated** endpoint that accepts the order identifier (from section 2) and returns the current transaction status. Edge queries this without partner credentials, so it must not require an API key.

The `edge-reports-server` normalizes provider statuses to this set when writing `StandardTx` records (the `asStatus` cleaner in `src/types.ts`):

| Status | Meaning |
|---|---|
| `complete` | Transaction finished successfully |
| `pending` | Order created, awaiting deposit or processing |
| `processing` | Deposit received, swap/transfer in progress |
| `confirming` | Awaiting blockchain confirmations |
| `withdrawing` | Payout in flight to the destination address |
| `expired` | Order timed out before deposit was received |
| `refunded` | Funds returned to sender |
| `failed` | Transaction failed permanently |
| `cancelled` | Order cancelled by user or provider |
| `blocked` | Order held for review |
| `other` | Catch-all for provider-specific states |

The provider does not need to use these exact strings, since each reporting plugin maps the provider's native status values. The API **must** still distinguish at minimum between: pending/in-progress, completed, expired, and refunded/failed states.

Providers that can stall an order pending user input (most fiat ramps, where KYC documents or additional details are outstanding) **must** also expose an **`infoNeeded`** state, distinct from generic pending. Edge uses it to prompt the user rather than leave them waiting on an order that will never progress on its own. `StandardTx` has no dedicated value for this, so reporting plugins currently normalize it to `blocked`; the distinction matters at the status API and in the GUI, not in reports.

### 6. Reporting API

The provider **must** expose an authenticated API that returns all transactions created through Edge (identified by affiliate/partner credentials). This API feeds into `edge-reports-server` where each provider has a reporting plugin (`src/partners/<provider>.ts`) that normalizes records into the `StandardTx` format.

#### Pagination and filtering

The API **must** support paginated queries filtered by a **start date**, an **end date**, and a **maximum record count**, so the reporting pipeline can poll incrementally for new transactions instead of re-reading the full history on every run.

Pagination within that date range may be offset-based or cursor/bookmark-based; either is acceptable. The date range itself is not optional: without it the pipeline cannot bound a query to the window it has not yet ingested.

#### Required data per transaction

Each transaction record must include enough information for the reporting plugin to populate a `StandardTx`. The field names below are from the `StandardTx` type; the provider's names will differ, and the plugin handles the mapping:

| `StandardTx` field | Description | Required |
|---|---|---|
| `orderId` | Unique order identifier (must match section 2) | Yes |
| `status` | Transaction status (see section 5) | Yes |
| `isoDate` / `timestamp` | Order **creation** date (ISO 8601 string and/or unix timestamp) | Yes |
| (no field yet) | Order **completion** date, when the order reached a terminal status | Yes, see below |
| `depositCurrency` / `payoutCurrency` | Currency codes for source and destination | Yes |
| `depositAmount` / `payoutAmount` | Amounts for source and destination | Yes |
| `depositAddress` / `payoutAddress` | Deposit and withdrawal addresses | Yes |
| `depositTxid` / `payoutTxid` | On-chain transaction IDs | Yes |
| `depositChainPluginId` / `payoutChainPluginId` | Chain identifier for each side (e.g. `"solana"`, `"bitcoin"`) | Yes |
| `depositTokenId` / `payoutTokenId` | Token contract address, or `null` for native assets | Yes |
| `depositEvmChainId` / `payoutEvmChainId` | Numeric EVM chain ID for the side, whenever that side is an EVM chain | Yes, for EVM chains |
| `countryCode` | User's country (ISO 3166-1 alpha-2) | Fiat providers only |
| `direction` | `'buy'` or `'sell'` (fiat) or `null` (swap) | Fiat providers only |
| `paymentType` | Payment method (e.g. `'sepa'`, `'credit'`, `'ach'`) | Fiat providers only |

**Both dates are required from the provider.** The response **must** carry the order creation date and, for orders in a terminal status, the completion/settlement date. `StandardTx` currently persists only the creation date (as `isoDate` and `timestamp`) and has no completion field, so the completion date survives only inside `rawTx` today. Providers should still return it: settlement time is needed for partner reporting, and the field is expected to be promoted to a first-class `StandardTx` column.

Reported amounts **should** use [native units](#amount-representation), the same as every other amount in this document. If the API reports in display units, it **must** document that convention.

`StandardTx` itself stores `depositAmount`, `payoutAmount` and `usdValue` as **display-unit numbers**: it types them via `asSafeNumber`, and native units on a high-decimal asset would overflow the safe integer range. That constrains Edge's storage, not the provider's wire format, and converting into it is the reporting plugin's job.

The reporting plugin also stores the raw provider response in `rawTx` for auditing, so including additional metadata in the response is helpful.

### 7. Account activation

Some blockchain networks require account activation or a reserve balance before an address can receive funds, XRP, HBAR and Tron among them. For any such network the provider supports, the provider **must** detect unactivated destination addresses and handle activation as part of the withdrawal, without requiring additional action from the user or from Edge.

### 8. Affiliate revenue withdrawal

- The provider **must** automatically withdraw affiliate revenue no later than **24 hours after each month-end (GMT)**. Edge should **not** be required to initiate withdrawals.
- Withdrawal must be supported in at least **BTC, ETH, and USDC** to a fixed address verified by Edge.
- Any changes to the withdrawal address **must** require additional authentication (e.g. 2FA and/or email verification).

---

## Additional requirements for fiat on/off ramp providers

Fiat providers in Edge are integrated through the GUI's fiat plugin system (`edge-react-gui/src/plugins/gui/`). Each provider implements the `FiatProvider` interface, which receives quote parameters including region, fiat currency, payment type, and crypto asset. The requirements below ensure the provider API supports the data flows this system needs.

### 9. User authentication

The provider **must** support a way for Edge to authenticate users programmatically, without requiring the user to create an account on the provider's website. Edge generates a **cryptographically random** per-user identifier (`authKey`) and passes it with every quoting and order execution request.

The provider can consume that identifier however it likes:

- Treat it as an API key or token and associate it with a user account
- Use it to create and retrieve a user session
- Key a signed challenge/response flow to it

The identifier **must** originate with Edge, not with the provider. When it names a user the provider has not seen before, account creation **must** proceed through the API by accepting KYC information (section 11), never through an external registration page.

### 10. Regional and fiat currency support

The quoting API **must** accept the user's region and fiat currency. In Edge, region is represented as:

```typescript
interface FiatPluginRegionCode {
  countryCode: string        // ISO 3166-1 alpha-2 (e.g. "US", "DE")
  stateProvinceCode?: string // e.g. "CA", "NY" (where applicable)
}
```

The API **must** return structured errors (see [section 3](#3-error-handling)) for unsupported regions and unsupported fiat currencies. In Edge, these map to `FiatProviderError` with `errorType: 'regionRestricted'` and `errorType: 'fiatUnsupported'` respectively.

### 11. KYC information

The provider API **must** allow Edge to submit KYC information **via API** (not via a widget or redirect):

- Full name
- Address (street, city, postal code, country)
- Phone number
- Email address

Additional verification steps (e.g. document upload, facial recognition) may use a widget (see section 14), but basic identity information must be submittable programmatically.

### 12. Bank information

For payment methods that require bank details (e.g. wire transfers, SEPA, ACH), the provider **must** expose an API for Edge to submit bank account information. The API should support the relevant identifiers for its operating regions (IBAN, account number + routing number, etc.).

### 13. Verification

- The API **must** allow Edge to submit provider-generated verification codes for phone and/or email verification.
- The API **must** indicate when specific KYC information is missing or outdated, so Edge can prompt the user. This can be through dedicated status endpoints, error responses on quote/order requests, or a KYC step lifecycle that reports step status.

### 14. Widgets

Any required widgets (e.g. for credit card entry, document upload, or biometric scans) **must** accept a return URI / redirect URL parameter from Edge, so the widget redirects back once it completes and the app can resume its flow.

Any step that takes a card payment, Apple Pay, or Google Pay has to run in the system browser (SafariView on iOS, Custom Tabs on Android). Those payment methods are unavailable to an embedded WebView, and an embedded WebView is a surface the host app can inject JavaScript into, which no card processor accepts for cardholder data entry. Edge cannot observe that page, so a redirect to a URI Edge registered is the only route back.

Edge does display widgets in its own WebView for steps that take no payment, such as bank-account linking and sell flows, and there a completion signal Edge can observe is workable too:

- Navigation to a known path
- A `postMessage` to the host

Neither carries over to the system browser, so a widget offering only these cannot host a payment step.

### 15. Off-ramp flow

For off-ramp (sell) transactions where the user has already completed KYC and linked a payment method, the provider **must** support a **fully API-driven flow** (no widget required) by returning:

- A crypto deposit address where Edge sends the funds
- An expiration time for the deposit address / quote (if applicable), so Edge can display a countdown and warn the user
