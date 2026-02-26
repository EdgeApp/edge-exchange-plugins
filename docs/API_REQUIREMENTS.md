# Edge Exchange Provider API Requirements

Technical API requirements for third-party exchange providers integrating with the Edge wallet platform, covering **crypto-to-crypto swap providers** and **fiat on/off ramp providers**.

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

If native units are not feasible, the API **must** clearly document which unit convention is used for every amount field.

---

## Requirements for All Providers

### 1. Chain and Token Identification

The API **must** accept a unique chain identifier and token identifier (such as the contract address) when requesting quotes and creating orders. It is **not** sufficient to only provide a separate "list all assets" endpoint — the exact asset must be specifiable in the quote/order request itself.

Edge exchange plugins will map the provider's chain network identifiers to Edge-specific identifiers, so they do not need to match exactly.

**Example — non-EVM asset:**

```json
{
  "chainNetwork": "solana",
  "tokenId": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC
}
```

**Example — EVM asset:**

For EVM chains, the API **must** also accept the standard EVM `chainId` (e.g. `1` for Ethereum, `56` for BNB Smart Chain).

```json
{
  "chainNetwork": "evmGeneric",
  "chainId": 56, // BNB Smart Chain
  "tokenId": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"
}
```

### 2. Order Identification and Status Page

- Every order response **must** include a unique `orderId` usable to query order status via an **unauthenticated** API endpoint and correlate with transactions in the Reporting API (section 6).
- The provider **must** host an unauthenticated, user-facing status page accessible by `orderId`. Example: `https://status.provider.com/orderStatus/{orderId}`

### 3. Error Handling

When a quote request fails, the API **must** return **all** applicable errors in a **single response** as structured JSON objects with machine-readable error codes. Edge has business logic to determine which error takes priority.

#### Required error types

| Error Type | Required Fields |
|---|---|
| **Region restricted** | Error code |
| **Asset not supported** | Error code, which asset(s) are unsupported |
| **Over limit** | Error code, `sourceAmountLimit`, `destinationAmountLimit` |
| **Under limit** | Error code, `sourceAmountLimit`, `destinationAmountLimit` |

#### Structured error format

```json
{
  "errors": [
    {
      "error": "OverLimitError",
      "sourceAmountLimit": 978900000, // 0.009789 BTC, when quoting with the "from/source" side
      "destinationAmountLimit": 1000000000000 // $1M USDT, when quoting with the "to/destination" side (if supported)
    },
    {
      "error": "RegionRestricted"
    }
  ]
}
```

**Incorrect — unstructured string message (will not be accepted):**

```json
{
  "error": "Amount is below the minimum of 0.0001 BTC"
}
```

#### Limit error field definitions

| Field | Type | Description |
|---|---|---|
| `error` | `string` (enum) | Machine-readable error code, e.g. `"OverLimitError"`, `"UnderLimitError"` |
| `sourceAmountLimit` | `number` | The limit in the source asset |
| `destinationAmountLimit` | `number` | The limit in the destination asset |

Both `sourceAmountLimit` and `destinationAmountLimit` are required. Limit amounts should use [native units](#amount-representation) where possible.

### 4. Quoting Requirements

The API **must** support bi-directional quoting: the user can specify either the source amount or the destination amount, and the API returns the corresponding counterpart.

Quoted amounts should use [native units](#amount-representation) where possible.

### 5. Transaction Status API

The provider **must** expose a transaction status endpoint that accepts an `orderId` and returns the current status.

```
GET /api/status/{orderId}
```

**Response:**

```json
{
  "orderId": "{orderId}",
  "status": "pending" | "processing" | "infoNeeded" | "expired" | "refunded" | "completed"
}
```

### 6. Reporting API

The provider **must** expose an authenticated reporting API that returns all transactions created through Edge, supporting paginated queries with `startDate`, `endDate`, and `limit` parameters.

Each transaction record **must** include the fields below (names do not need to match exactly). Amount fields should use [native units](#amount-representation) where possible.

```json
{
  "orderId": "pr39dhg2409ryhgei39r",
  "status": "completed",
  "createdDate": "2025-07-10T17:24:25.997Z",
  "completedDate": "2025-07-10T17:28:00.997Z",
  "sourceNetwork": "solana",
  "sourceTokenId": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "sourceCurrencyCode": "USDC",
  "sourceAmount": 118123,
  "sourceEvmChainId": null,
  "destinationNetwork": "bitcoin",
  "destinationTokenId": null,
  "destinationCurrencyCode": "BTC",
  "destinationAmount": 1.01,
  "destinationEvmChainId": null,
  "payinAddress": "B8kGR7GpPh7GUsTgDgzjQYoJEFbpPr6q2V4iLEDeF6AD",
  "payoutAddress": "bc1q05wqn9nffg874fc6mp23lagfutawtwljx8udwy",
  "payinTxid": "wtpqAqCJj2iNte6iA6UUPtc5xgaRNGdjFuPk9B9VYFxkqxtSkSiC99gPU8MnGCEstbRTX3gQY5ErQn1475iuhFD",
  "payoutTxid": "2f6fbb24058e578d0a51842dfd8e79935df1702130c0a7ba3e8ef442bfc0f41c"
}
```

| Field | Description |
|---|---|
| `orderId` | Must match the `orderId` from the quoting/order API |
| `status` | One of: `pending`, `processing`, `infoNeeded`, `expired`, `refunded`, `completed` |
| `sourceNetwork` / `destinationNetwork` | Chain identifier (e.g. `"solana"`, `"bitcoin"`) |
| `sourceTokenId` / `destinationTokenId` | Contract address, or `null` for the chain's native asset |
| `sourceEvmChainId` / `destinationEvmChainId` | EVM chain ID if applicable, otherwise `null` |
| `payinAddress` / `payoutAddress` | Deposit and withdrawal addresses |
| `payinTxid` / `payoutTxid` | On-chain transaction IDs |

### 7. Account Activation

Some blockchain assets (e.g. XRP, HBAR) require account activation before they can receive funds. The provider **must** detect unactivated destination addresses and include the activation transaction as part of the withdrawal — without requiring any additional action from the user or from Edge.

### 8. Affiliate Revenue Withdrawal

- The provider **must** automatically withdraw affiliate revenue no later than **24 hours after each month-end (GMT)**. Edge should **not** be required to initiate withdrawals.
- Withdrawal must be supported in at least **BTC, ETH, and USDC** to a fixed address verified by Edge.
- Any changes to the withdrawal address **must** require additional authentication (e.g. 2FA and/or email verification).

---

## Additional Requirements for Fiat On/Off Ramp Providers

### 9. User Authentication

The provider API **must** allow Edge to authenticate users via a cryptographically random `authKey` generated by Edge, passed with every quoting or order execution request.

If the `authKey` does not yet exist on the provider's system, the API **must** support account creation by accepting KYC information via API — without requiring an external registration page.

### 10. Regional and Fiat Currency Support

The quoting API **must** accept the user's region (country and, where applicable, province/state) and fiat currency. The API must return structured errors (see [section 3](#3-error-handling)) for unsupported regions and unsupported fiat currencies.

### 11. KYC Information

The provider API **must** allow Edge to submit KYC information **via API** (not via a widget or redirect):

- Full name
- Address
- Phone number
- Email address

### 12. Bank Information

For payment methods without conflicting regulatory requirements (e.g. wire transfers, SEPA), the provider **must** expose an API for Edge to submit bank account details (account number, IBAN, routing number, etc.).

### 13. Verification

- The API **must** allow Edge to submit provider-generated verification codes for phone and email verification.
- The API **must** indicate when specific KYC information is missing or outdated, so Edge can prompt the user.

### 14. Widgets

Any required widgets (e.g. for credit card entry or facial biometric scans) **must** accept a return URI parameter from Edge to allow closing the webview and resuming the application flow.

### 15. Off-Ramp Flow

For off-ramp transactions where the user has already linked a payment method, the provider **must** support a **fully no-widget flow** by returning:

- A crypto deposit address where Edge sends the funds
- An expiration time for the deposit address (if applicable)
