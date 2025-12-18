# Edge Exchange Provider API Requirements

## Requirements for both Swap and On/Off Ramp providers

### 1. Chain and Token Identification

API must allow requesting quotes and orders using a unique chain identifier and token identifier such as the contract address. This is to prevent confusion on which token is being referenced as well to prevent the need to map provider tickers to tokens supported by Edge. Note that it is NOT sufficient to provide a separate endpoint to list all assets as this would require too many API calls to get a quote. This example shows how assets should be specified for a quote. The Edge exchange plugins will map the provider's chain network identifiers to edge specific chain network identifiers so they need not match exactly.

```json
{
  "chainNetwork": "solana",
  "tokenId": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" // USDC
}
```

For EVM chains, API must allow requesting quotes using the universally accepted EVM `chainId` to specify the chain in addition to the token identifier. This allows automatic support of new EVMs with no need to add a mapping of provider chain identifiers to Edge chain identifiers. Ie

```json
{
  "chainNetwork": "evmGeneric",
  "chainId": 56 // BNB Smart Chain
}
```

### 2. Order Identification and Status Page

- Order requests must provide a unique `orderId` identifier that can be used to query status of the order via an unauthenticated API as well as connect the order with completed swaps reported via a reporting API.
- Provider must provide an un-authenticated status page that uses the `orderId` to provide status on the swap. Ie [`https://status.provider.com/orderStatus/{orderId`](https://status.provider.com/orderStatus/{orderId)`}`

### 3. Error Handling

Quote request errors must return all the following possible errors at once with all the mentioned details. This is to ensure that Edge can surface the most relevant error to the user. This prevents irrelevant errors like below limit errors from being surfaced to the user when the user would also be region restricted.

- Region restricted error
- Asset unsupported error
- Above or below limit errors with min/max amounts specified in both the source and destination asset

Limit errors need to be specified with a hardened error code and not using an arbitrary string. Ie. for swap from BTC to USDT

```json
{
  "errors": [
    {
      "error": "OverLimitError",
      "sourceAmountLimit": 9.789, // BTC
      "destinationAmountLimit": 1000000 // USDT
    },
    {
      "error": "RegionRestricted"
    }
  ]
}
```

### 4. Quoting Requirements

- Provider must allow bi-directional quoting such that the user can specify either the source asset amount or destination asset amount.

### 5. Transaction Status API

Provider must provide a transaction status API that allows querying of transaction status by `orderId`. This allows the Edge UI to show an updated transaction status to the user when they view the outgoing transaction.

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

Provider must provide an authenticated reporting API that allows querying of all transactions created using Edge. The reporting API must provide at minimum the following information for each transaction. Actual values are only examples. Similar values that can be mapped to the below are sufficient. API must allow paginated queries with start date, end date, and number of values.

```json
{
  "orderId": "pr39dhg2409ryhgei39r", // Must match the orderId from quoting API
  "status": "pending" | "processing" | "infoNeeded" | "expired" | "refunded" | "completed",
  "createdDate": "2025-07-10T17:24:25.997Z",
  "completedDate": "2025-07-10T17:28:00.997Z",
  "sourceNetwork": "solana",
  "sourceTokenId": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "sourceCurrencyCode": "USDC",
  "sourceAmount": 118123,
  "sourceEvmChainId": null, // source not an EVM chain
  "destinationNetwork": "bitcoin",
  "destinationTokenId": null, // signified no token but primary gas token asset BTC
  "destinationCurrencyCode": "BTC",
  "destinationAmount": 1.01,
  "destinationEvmChainId": null, // destination not an EVM chain
  "payinAddress": "B8kGR7GpPh7GUsTgDgzjQYoJEFbpPr6q2V4iLEDeF6AD",
  "payoutAddress": "bc1q05wqn9nffg874fc6mp23lagfutawtwljx8udwy",
  "payinTxid": "wtpqAqCJj2iNte6iA6UUPtc5xgaRNGdjFuPk9B9VYFxkqxtSkSiC99gPU8MnGCEstbRTX3gQY5ErQn1475iuhFD",
  "payoutTxid": "2f6fbb24058e578d0a51842dfd8e79935df1702130c0a7ba3e8ef442bfc0f41c"
}
```

### 7. Account Activation

When a user requests an exchange into assets like XRP and HBAR. The provider should detect that the withdrawal address is not activated and send an activation transaction as part of the withdrawal.

### 8. Affiliate Revenue Withdrawal

Providers must automatically withdraw affiliate revenue funds in a single asset no later than 24 hours after the month close GMT time. Funds withdrawal should be allowed in at least BTC, ETH, and USDC to a fixed address verified by Edge. Edge should not be required to initiate withdrawal via an API or dashboard. Any changes to the withdrawal address should be verified with additional authentication such as 2FA codes and/or email verification.

## Additional requirements for fiat on/off ramp providers

### 9. User Authentication

Provider API should allow the Edge application to authenticate a user via cryptographically random authKey. The authKey should be created by Edge and passed into any quoting or order execution endpoint. If the authKey does not exist on the Provider system, the Provider's API should allow for account creation by receiving KYC info via API

### 10. Regional and Fiat Currency Support

Provider quoting API should allow specifying not just the crypto asset but also the region (country/province) and fiat currency to receive a quote. Proper errors should be returned for unsupported regions and unsupported fiat currencies.

### 11. KYC Information

Provider API should allow the Edge application to provide basic KYC information and verification via API (not widget). Basic KYC information includes

- Name
- Address
- Phone number
- Email address

### 12. Bank Information

For basic bank transfers (ie. wire, SEPA) and any payment methods that do not have opposing regulatory requirements, Provider must have an API that allows Edge to submit bank information. Ie Account number, IBAN, and routing number.

### 13. Verification

- API should allow the Edge application to send KYC verification codes for phone and email verification. Verification codes are still generated by the provider servers, not Edge. Users enter verification codes into the Edge UI and are sent to provider via API.
- An API should let Edge know when a specific piece of KYC information is missing or out of date to allow the Edge application to collect such info to send to the Provider's API.

### 14. Widgets

Any required widgets (ie for submitting credit card info or facial scan) must allow Edge to specify return URIs once the widget is complete. This allows Edge to close any webviews and continue with the application flow.

### 15. Off-Ramp Flow

For off-ramp transactions that have already had a payment method linked to the user's account, the provider must allow for a full "no-widget" flow by simply providing a crypto address that must receive funds and an expiration time (if necessary).
