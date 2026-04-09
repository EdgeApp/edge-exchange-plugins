# Edge Exchange Provider API Requirements

Technical API requirements for third-party exchange providers integrating with the Edge wallet platform, covering **crypto-to-crypto swap providers** and **fiat on/off ramp providers**.

These requirements exist to enable smooth integration across three Edge repositories:

- **[edge-exchange-plugins](https://github.com/AirshipApp/edge-exchange-plugins)** — swap plugins that call the provider API and map responses to Edge core types (`EdgeSwapQuote`, `EdgeTxActionSwap`, etc.)
- **[edge-react-gui](https://github.com/AirshipApp/edge-react-gui)** — the wallet UI that displays quotes, errors, transaction details, and opens provider status pages
- **[edge-reports-server](https://github.com/AirshipApp/edge-reports-server)** — the reporting pipeline that queries provider APIs and normalizes transactions into `StandardTx` records for revenue analytics

Field names and JSON shapes in this document are illustrative — the plugin layer handles mapping between provider-specific names and Edge types. What matters is that the **information** is available and machine-readable.

**All requirements are mandatory** unless explicitly stated otherwise.

### Table of Contents

**General principles:**

- [Amount Representation](#amount-representation)

**Requirements for all providers:**

1. [Chain and Token Identification](#1-chain-and-token-identification)
2. [Order Identification and Status Page](#2-order-identification-and-status-page)
3. [Error Handling](#3-error-handling)
4. [Quoting Requirements](#4-quoting-requirements)
5. [Transaction Status API](#5-transaction-status-api)
6. [Reporting API](#6-reporting-api)
7. [Account Activation](#7-account-activation)
8. [Affiliate Revenue Withdrawal](#8-affiliate-revenue-withdrawal)

**Additional requirements for fiat on/off ramp providers:**

9. [User Authentication](#9-user-authentication)
10. [Regional and Fiat Currency Support](#10-regional-and-fiat-currency-support)
11. [KYC Information](#11-kyc-information)
12. [Bank Information](#12-bank-information)
13. [Verification](#13-verification)
14. [Widget Return URIs](#14-widgets)
15. [Off-Ramp Flow](#15-off-ramp-flow)

---

## General Principles

### Amount Representation

Amounts **should** be expressed in the asset's **native (smallest indivisible) units** rather than display units:

| Asset | Native unit | Example: 1.5 display units |
|---|---|---|
| BTC | satoshis | `150000000` |
| ETH | wei | `1500000000000000000` |
| SOL | lamports | `1500000000` |
| USDC (6 decimals) | micro-units | `1500000` |

Edge swap plugins convert between native and display units using `denominationToNative` / `nativeToDenomination` (see [`CREATING_AN_EXCHANGE_PLUGIN.md`](./CREATING_AN_EXCHANGE_PLUGIN.md) Step 5), so display-unit APIs are workable. However, if native units are not used, the API **must** clearly document which unit convention applies to every amount field so the plugin can convert correctly.

---

## Requirements for All Providers

### 1. Chain and Token Identification

The API **must** accept a unique chain identifier and token identifier (such as the contract address) when requesting quotes and creating orders. It is **not** sufficient to only provide a separate "list all assets" endpoint — the exact asset must be specifiable in the quote/order request itself.

Edge exchange plugins maintain a mapping file (`src/mappings/<provider>.ts`) that translates Edge `pluginId` values (e.g. `'ethereum'`, `'bitcoin'`, `'solana'`) to the provider's chain codes. The provider's identifiers do not need to match Edge's — they just need to be stable and unique per chain.

For EVM chains, the API **should** accept the standard numeric EVM `chainId` (e.g. `1` for Ethereum, `56` for BNB Smart Chain). This avoids ambiguity with provider-specific EVM network names.

For tokens, the API **must** accept the on-chain contract address (or equivalent identifier) to distinguish tokens on the same chain.

**Example — non-EVM asset:**

```json
{
  "network": "solana",
  "contractAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
}
```

**Example — EVM asset:**

```json
{
  "network": "bsc",
  "evmChainId": 56,
  "contractAddress": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"
}
```

### 2. Order Identification and Status Page

- Every order/quote response **must** include a unique order identifier that the plugin can store as `orderId` on the `EdgeTxActionSwap` (swap) or `EdgeTxActionFiat` (fiat) saved with the transaction. This same identifier must be usable to query the Transaction Status API (section 5) and must match records in the Reporting API (section 6).
- The provider **must** host an unauthenticated, user-facing status page accessible by order identifier. The Edge GUI opens this URL (stored as `orderUri` on the transaction action) so users can track their order outside the app. Example: `https://provider.com/status/{orderId}`

### 3. Error Handling

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

Edge supports bi-directional quoting — the user may be specifying either the source amount or the destination amount (`quoteFor: 'from' | 'to'`). The plugin selects the appropriate limit based on which side the user specified:

```typescript
const nativeLimit = denominationToNative(
  quoteFor === 'from' ? request.fromWallet : request.toWallet,
  quoteFor === 'from' ? limitError.sourceLimitAmount : limitError.destinationLimitAmount,
  quoteFor === 'from' ? request.fromTokenId : request.toTokenId
)
```

If the API can only return one side, the plugin cannot display the correct limit when the user quotes from the other direction.

#### Example structured error response

```json
{
  "errors": [
    {
      "code": "ABOVE_LIMIT",
      "sourceLimitAmount": "0.009789",
      "destinationLimitAmount": "1000000"
    },
    {
      "code": "REGION_UNSUPPORTED"
    }
  ]
}
```

The exact field names and code strings can vary — the plugin defines cleaners to parse the provider's specific format. What matters is that:
1. All errors are returned at once (not just the first one)
2. Error types are machine-readable codes (not embedded in human-readable messages)
3. Limit errors include amounts for both sides of the trade

**Incorrect — unstructured string message:**

```json
{
  "error": "Amount is below the minimum of 0.0001 BTC"
}
```

### 4. Quoting Requirements

The API **must** support bi-directional quoting: the user can specify either the source amount or the destination amount, and the API returns the corresponding counterpart. In Edge, this maps to `EdgeSwapRequest.quoteFor: 'from' | 'to' | 'max'`.

Additionally, the API **should** support a "max" quote where the user wants to swap their entire balance. If the API does not support this natively, the plugin will emulate it by querying the user's balance and requesting a `'from'` quote with that amount.

### 5. Transaction Status API

The provider **must** expose an endpoint that accepts the order identifier (from section 2) and returns the current transaction status.

The `edge-reports-server` normalizes provider statuses to this set when writing `StandardTx` records:

| Status | Meaning |
|---|---|
| `complete` | Transaction finished successfully |
| `pending` | Order created, awaiting deposit or processing |
| `processing` | Deposit received, swap/transfer in progress |
| `confirming` | Awaiting blockchain confirmations |
| `expired` | Order timed out before deposit was received |
| `refunded` | Funds returned to sender |
| `failed` | Transaction failed permanently |
| `cancelled` | Order cancelled by user or provider |
| `blocked` | Order held for review |
| `other` | Catch-all for provider-specific states |

The provider does not need to use these exact strings — each reporting plugin maps the provider's native status values. However, the API **must** distinguish at minimum between: pending/in-progress, completed, expired, and refunded/failed states.

### 6. Reporting API

The provider **must** expose an authenticated API that returns all transactions created through Edge (identified by affiliate/partner credentials). This API feeds into `edge-reports-server` where each provider has a reporting plugin (`src/partners/<provider>.ts`) that normalizes records into the `StandardTx` format.

#### Pagination and filtering

The API **must** support incremental querying so the reporting pipeline can efficiently poll for new transactions. Acceptable approaches include:

- Date range filtering (start/end date) with pagination (limit/offset or cursor)
- Offset-based pagination with a reasonable page size
- Cursor/bookmark-based pagination

#### Required data per transaction

Each transaction record must include enough information for the reporting plugin to populate a `StandardTx`. The field names below are from the `StandardTx` type — the provider's field names will differ and the plugin handles the mapping:

| `StandardTx` field | Description | Required |
|---|---|---|
| `orderId` | Unique order identifier (must match section 2) | Yes |
| `status` | Transaction status (see section 5) | Yes |
| `isoDate` / `timestamp` | Creation date (ISO 8601 string and/or unix timestamp) | Yes |
| `depositCurrency` / `payoutCurrency` | Currency codes for source and destination | Yes |
| `depositAmount` / `payoutAmount` | Amounts for source and destination | Yes |
| `depositAddress` / `payoutAddress` | Deposit and withdrawal addresses | Recommended |
| `depositTxid` / `payoutTxid` | On-chain transaction IDs | Recommended |
| `depositTokenId` / `payoutTokenId` | Token contract address, or `null` for native assets | Recommended |
| `depositEvmChainId` / `payoutEvmChainId` | Numeric EVM chain ID if applicable | Recommended for EVM chains |
| `countryCode` | User's country (ISO 3166-1 alpha-2) | Fiat providers only |
| `direction` | `'buy'` or `'sell'` (fiat) or `null` (swap) | Fiat providers only |
| `paymentType` | Payment method (e.g. `'sepa'`, `'credit'`, `'ach'`) | Fiat providers only |

The reporting plugin also stores the raw provider response in `rawTx` for auditing, so including additional metadata in the response is helpful.

### 7. Account Activation

Some blockchain networks (e.g. XRP, HBAR, Tron) require account activation or reserve balances before an address can receive funds. For any such network the provider supports, the provider **must** detect unactivated destination addresses and handle activation as part of the withdrawal — without requiring additional action from the user or from Edge.

### 8. Affiliate Revenue Withdrawal

- The provider **must** automatically withdraw affiliate revenue no later than **24 hours after each month-end (GMT)**. Edge should **not** be required to initiate withdrawals.
- Withdrawal must be supported in at least **BTC, ETH, and USDC** to a fixed address verified by Edge.
- Any changes to the withdrawal address **must** require additional authentication (e.g. 2FA and/or email verification).

---

## Additional Requirements for Fiat On/Off Ramp Providers

Fiat providers in Edge are integrated through the GUI's fiat plugin system (`edge-react-gui/src/plugins/gui/`). Each provider implements the `FiatProvider` interface, which receives quote parameters including region, fiat currency, payment type, and crypto asset. The requirements below ensure the provider API supports the data flows this system needs.

### 9. User Authentication

The provider **must** support a way for Edge to authenticate users programmatically — without requiring the user to create an account on the provider's website. Edge generates a unique per-user identifier and passes it to the provider with every request.

The implementation can be:
- An API key or token that Edge generates and the provider associates with a user account
- A device-based identifier that the provider uses to create and retrieve user sessions
- A signed challenge/response flow

The key requirement is that user creation and authentication happen through API calls, not through an external registration page.

### 10. Regional and Fiat Currency Support

The quoting API **must** accept the user's region and fiat currency. In Edge, region is represented as:

```typescript
interface FiatPluginRegionCode {
  countryCode: string        // ISO 3166-1 alpha-2 (e.g. "US", "DE")
  stateProvinceCode?: string // e.g. "CA", "NY" (where applicable)
}
```

The API **must** return structured errors (see [section 3](#3-error-handling)) for unsupported regions and unsupported fiat currencies. In Edge, these map to `FiatProviderError` with `errorType: 'regionRestricted'` and `errorType: 'fiatUnsupported'` respectively.

### 11. KYC Information

The provider API **must** allow Edge to submit KYC information **via API** (not via a widget or redirect):

- Full name
- Address (street, city, postal code, country)
- Phone number
- Email address

Additional verification steps (e.g. document upload, facial recognition) may use a widget (see section 14), but basic identity information must be submittable programmatically.

### 12. Bank Information

For payment methods that require bank details (e.g. wire transfers, SEPA, ACH), the provider **must** expose an API for Edge to submit bank account information. The API should support the relevant identifiers for its operating regions (IBAN, account number + routing number, etc.).

### 13. Verification

- The API **must** allow Edge to submit provider-generated verification codes for phone and/or email verification.
- The API **must** indicate when specific KYC information is missing or outdated, so Edge can prompt the user. This can be through dedicated status endpoints, error responses on quote/order requests, or a KYC step lifecycle that reports step status.

### 14. Widgets

Any required widgets (e.g. for credit card entry, document upload, or biometric scans) **must** support closing and returning to the Edge app. Acceptable approaches:

- Accept a return URI / redirect URL parameter so the webview can navigate back to Edge
- Support deep link callbacks that Edge can listen for
- Provide a clear "done" signal (URL navigation to a known path, postMessage, etc.) that Edge can detect to close the webview

The Edge GUI displays widgets in either an in-app WebView or an external browser (SafariView / Custom Tabs). Both flows need a way to detect completion and return control to the app.

### 15. Off-Ramp Flow

For off-ramp (sell) transactions where the user has already completed KYC and linked a payment method, the provider **must** support a **fully API-driven flow** (no widget required) by returning:

- A crypto deposit address where Edge sends the funds
- An expiration time for the deposit address / quote (if applicable), so Edge can display a countdown and warn the user
