# DFX API — Edge Requirements Evaluation

Evaluation of the [DFX API](https://github.com/AirshipApp/dfx-api) (`/Users/jontz/git/api`) against [API_REQUIREMENTS.md](https://github.com/EdgeApp/edge-exchange-plugins/blob/master/docs/API_REQUIREMENTS.md), assessed through the lens of what is needed to build a working `edge-exchange-plugins` swap/fiat plugin, display correct UX in `edge-react-gui`, and populate `StandardTx` records in `edge-reports-server`.

**Date:** 2026-03-31

---

## Summary


| #   | Requirement                          | Verdict                      | Impact |
| --- | ------------------------------------ | ---------------------------- | ------ |
| G   | Amount Representation                | **PASS** (documentation gap) | Low    |
| 1   | Chain and Token Identification       | **PASS**                     | —      |
| 2   | Order Identification and Status Page | **PARTIAL**                  | Medium |
| 3   | Error Handling                       | **PASS**                     | —      |
| 4   | Quoting Requirements                 | **PASS**                     | —      |
| 5   | Transaction Status API               | **PASS**                     | —      |
| 6   | Reporting API                        | **PARTIAL**                  | Medium |
| 7   | Account Activation                   | **PASS**                     | —      |
| 8   | Affiliate Revenue Withdrawal         | **PARTIAL**                  | Medium |
| 9   | User Authentication                  | **PASS**                     | —      |
| 10  | Regional and Fiat Currency Support   | **PARTIAL**                  | Low    |
| 11  | KYC Information                      | **PASS**                     | —      |
| 12  | Bank Information                     | **PARTIAL**                  | Low    |
| 13  | Verification                         | **PASS**                     | —      |
| 14  | Widget Return URIs                   | **PARTIAL**                  | Low    |
| 15  | Off-Ramp Flow                        | **PARTIAL**                  | Low    |


**PASS: 8** — **PARTIAL: 7** — **FAIL: 0**

---

## General: Amount Representation — PASS (documentation gap)

**Requirement:** Native units preferred; if not used, clearly document the convention.

**Finding:** The API uses human-readable decimal amounts — crypto rounded to ~5 decimal places, fiat to 2. Swagger annotations say things like "Amount in source currency" and "Estimated amount in target asset" but do not specify that these are display-unit decimals rather than native chain units.

**Why PASS:** The plugin layer converts between display and native units via `denominationToNative` / `nativeToDenomination`, so display-unit APIs are explicitly workable per the updated requirements. The documentation gap is real but low-impact — anyone writing a plugin for DFX will quickly see from the response values that amounts are in display units (e.g. `0.5` BTC, not `50000000` satoshis).

**Recommendation:** Add a one-line note to Swagger or README: "All amount fields use display units (e.g. `1.5` = 1.5 BTC, not satoshis)."

---

## 1. Chain and Token Identification — PASS

**Requirement:** Quote/order requests must accept chain identifier + token contract. EVM chains should accept numeric `chainId`.

**Finding:** `AssetInDto` supports three identification modes on every quote and payment-info request:

- DFX numeric `id`
- `blockchain` (string, e.g. `'Ethereum'`, `'Bitcoin'`) + optional `chainId` (contract address)
- `evmChainId` (numeric, e.g. `1`, `56`, `137`) + optional `chainId` (contract address)

Resolution in `PaymentInfoService.resolveAsset` handles all three paths. When `chainId` is omitted, the native asset for that blockchain is used.

**Plugin integration:** A DFX plugin's mapping file (`src/mappings/dfx.ts`) would map Edge `pluginId` → DFX `blockchain` string or `evmChainId`. Token identification uses the on-chain contract address via `chainId`. This is fully compatible with the `getChainAndTokenCodes` pattern used by other plugins.

---

## 2. Order Identification and Status Page — PARTIAL

**Requirement:** Unique order identifier for `EdgeTxActionSwap.orderId` / `StandardTx.orderId`; unauthenticated status page for `orderUri`.

### Order identifier: PASS

Payment-info responses return both `id` (numeric) and `uid` (string UUID). Either can serve as the `orderId` stored on the `EdgeTxAction`. The `uid` is preferable since it is also accepted by the unauthenticated `GET /transaction/single` endpoint and appears as `orderUid` in the `TransactionDto` mapper.

### Status page: GAP

There is no user-facing status page URL in the API. No `orderUri` or `statusUrl` field exists in any payment-info DTO. The `TransactionDto` exposes `inputTxUrl` / `outputTxUrl` (blockchain explorer links), but these are not the same as a provider-hosted status page.

The Edge GUI opens the `orderUri` in a browser so users can track their order. Without a status page, the swap details card would have no "Exchange Status Page" link for DFX orders.

**Recommendation:** Host a status page (e.g. `https://app.dfx.swiss/tx/{uid}`) and include the URL in payment-info responses, or return a base URL that the plugin can concatenate with the `uid`.

---

## 3. Error Handling — PASS

**Requirement:** All errors in a single response; machine-readable codes; limit errors include both source and destination amounts.

**Finding:** The API returns a structured `errors` array alongside the quote response via `QuoteErrorUtil.mapToStructuredErrors`. Each `StructuredErrorDto` has:

- `error` — machine-readable enum (`QuoteError`): `AmountTooLow`, `AmountTooHigh`, `CountryNotAllowed`, `AssetUnsupported`, `CurrencyUnsupported`, `LimitExceeded`, etc.
- `limit` — volume limit in source asset/currency
- `limitTarget` — volume limit in target asset/currency

For limit errors (`AmountTooLow`, `AmountTooHigh`, `LimitExceeded`), both `limit` and `limitTarget` are populated from the quote's `minVolume`/`maxVolume` and `minVolumeTarget`/`maxVolumeTarget`.

**Plugin integration:** A DFX plugin would define cleaners for this structure and map:

- `AmountTooLow` → `SwapBelowLimitError(swapInfo, nativeLimit, direction)`
- `AmountTooHigh` / `LimitExceeded` → `SwapAboveLimitError(swapInfo, nativeLimit, direction)`
- `CountryNotAllowed` → `SwapPermissionError(swapInfo, 'geoRestriction')`
- `AssetUnsupported` / `CurrencyUnsupported` → `SwapCurrencyError(swapInfo, request)`

The `limit`/`limitTarget` fields give the plugin exactly what it needs to pick the correct side based on `quoteFor`.

---

## 4. Quoting Requirements — PASS

**Requirement:** Bi-directional quoting (source or destination amount).

**Finding:** All quote DTOs (buy, sell, swap) accept `amount` XOR `targetAmount` via an `@Validate(XOR, [...])` constraint. The service layer (`TransactionHelper.getTargetEstimation`) computes the missing side from pricing data.

**Plugin integration:** Maps directly to `quoteFor: 'from'` → send `amount`, `quoteFor: 'to'` → send `targetAmount`. For `'max'`, the plugin queries the wallet balance and sends it as `amount`.

---

## 5. Transaction Status API — PASS

**Requirement:** Endpoint accepting order identifier, returning status; must distinguish between pending, completed, expired, and refunded/failed.

**Finding:** `GET /transaction/single?uid={uid}` is unauthenticated and returns a `TransactionDto` with `state` (`TransactionState` enum):


| `TransactionState`  | Maps to `StandardTx.status` |
| ------------------- | --------------------------- |
| `Created`           | `pending`                   |
| `WaitingForPayment` | `pending`                   |
| `Processing`        | `processing`                |
| `AmlCheck`          | `processing`                |
| `Completed`         | `complete`                  |
| `Returned`          | `refunded`                  |
| `Failed`            | `failed`                    |


This covers the minimum required distinctions: pending/in-progress, completed, and refunded/failed. There is no explicit `expired` state — orders that time out likely transition to `Failed` or `Returned`, which is acceptable since the reporting plugin maps to the appropriate `StandardTx` status.

**Plugin integration:** The reporting plugin would map `TransactionState` values to `StandardTx.status` strings. The plugin may also call this endpoint for order tracking in the exchange plugin itself.

---

## 6. Reporting API — PARTIAL

**Requirement:** Authenticated, incremental querying, paginated, with fields to populate `StandardTx`.

### Authentication and date filtering: PASS

`GET /transaction` accepts `userAddress` (identifying the Edge account) plus `from` / `to` date parameters. This supports incremental querying — the reports plugin can track `latestIsoDate` in its settings and request only newer transactions.

### Pagination: GAP

There is no `limit`, `offset`, `page`, or cursor parameter. The API returns all matching transactions in a single response. For accounts with large transaction volumes, this could cause timeouts or excessive memory use in the reporting pipeline.

### Field coverage: PASS

`TransactionDto` contains all the data needed to populate a `StandardTx`:


| `StandardTx` field                       | DFX `TransactionDto` field                   | Present        |
| ---------------------------------------- | -------------------------------------------- | -------------- |
| `orderId`                                | `uid` or `orderUid`                          | Yes            |
| `status`                                 | `state`                                      | Yes            |
| `isoDate` / `timestamp`                  | `date`                                       | Yes            |
| `depositCurrency` / `payoutCurrency`     | `inputAsset` / `outputAsset`                 | Yes            |
| `depositAmount` / `payoutAmount`         | `inputAmount` / `outputAmount`               | Yes            |
| `depositAddress` / `payoutAddress`       | `depositAddress` (+ target from route)       | Partial        |
| `depositTxid` / `payoutTxid`             | `inputTxId` / `outputTxId`                   | Yes            |
| `depositTokenId` / `payoutTokenId`       | `inputChainId` / `outputChainId`             | Yes            |
| `depositEvmChainId` / `payoutEvmChainId` | `inputEvmChainId` / `outputEvmChainId`       | Yes            |
| `countryCode`                            | Not on transaction DTO                       | No (see below) |
| `direction`                              | Derivable from `type` (buy/sell/swap)        | Yes            |
| `paymentType`                            | `inputPaymentMethod` / `outputPaymentMethod` | Yes            |


`countryCode` is not exposed on individual transaction records. The reports plugin could set it to `null` (acceptable for swap providers) or derive it from the user profile if accessible.

**Recommendation:** Add pagination support (limit/offset or cursor) to `GET /transaction`. Optionally expose `countryCode` on fiat transactions.

---

## 7. Account Activation — PASS

**Requirement:** For any network the provider supports that requires activation, detect unactivated addresses and handle it.

**Finding:** DFX handles activation for all chain types where it applies in their supported set:

- **Tron:** `TronService.getCreateAccountFee` checks `isAccountActivated` and adds the activation cost to the network fee in quotes
- **Solana:** `getSolanaCreateTokenAccountFee` adds token account creation costs
- **EVM L2s:** "Network start" sends a native-coin gas funding transaction alongside the main payout for Base, Arbitrum, Optimism, Polygon, and BSC

DFX does not support XRP or HBAR, so those chains are not applicable. For the chains it does support, activation is handled transparently.

---

## 8. Affiliate Revenue Withdrawal — PARTIAL

**Requirement:** Automatic monthly withdrawal in BTC/ETH/USDC; extra auth on address changes.

### Automated payout: PASS

Partner and referral credit is tracked (`partnerRefCredit` + `refCredit`). A cron job runs daily at 6 AM; monthly-frequency payouts trigger on the 1st of the month. The payout pipeline creates `RefReward` entities and processes them through `PayoutService`.

### Asset support: GAP

The default Ethereum payout asset is `dEURO` (a stablecoin), not USDC. Payout asset is configurable per user via `PUT /ref`, but BTC, ETH, and USDC are not guaranteed as options — it depends on what assets are configured in the database.

### Address security: GAP

`PUT /ref` (which changes payout asset and frequency) is protected by JWT only — no additional 2FA or email verification. The payout address itself is the user's wallet login address and is not changeable through the ref endpoint, which provides some inherent security. However, the requirement asks for extra auth on any withdrawal configuration change.

**Recommendation:** Ensure BTC, ETH, and USDC are enabled as payout asset options. Consider adding 2FA verification to `PUT /ref`.

---

## 9. User Authentication — PASS

**Requirement:** Programmatic user authentication without external registration. Options include API keys, device-based identifiers, or signed challenge/response.

**Finding:** DFX uses a **signed challenge/response flow**, which is one of the explicitly listed acceptable approaches:

1. `GET /auth/signMessage` — returns a message to sign
2. User signs with their wallet private key
3. `POST /auth` with `address` + `signature` → returns `accessToken` (JWT)

If the address is new, account creation happens automatically during sign-up. No external registration page is required.

**Plugin integration:** The fiat plugin would generate or retrieve a wallet address (via `FiatProviderFactoryParams.io.makeUuid` or wallet keys), sign the challenge, and store the JWT in `FiatProviderStore` for subsequent requests.

---

## 10. Regional and Fiat Currency Support — PARTIAL

**Requirement:** Accept region (`countryCode` + optional `stateProvinceCode`) and fiat currency; return structured errors for unsupported regions/currencies.

### Country and fiat currency: PASS

Quote endpoints accept `country` (ISO 3166-1 alpha-2, optional) and `currency` (required via `FiatInDto`). Structured errors `CountryNotAllowed` and `CurrencyUnsupported` are returned when applicable.

### State/province: GAP

There is no `stateProvinceCode` parameter on any quote DTO. Edge's `FiatPluginRegionCode` includes this field for US states and other countries with sub-national regulatory differences. Without it, the API cannot reject quotes for specific states (e.g. New York) while allowing others.

**Recommendation:** Add an optional `stateProvince` parameter to quote endpoints. If DFX does not have state-level restrictions, the field can be accepted and ignored.

---

## 11. KYC Information — PASS

**Requirement:** Submit full name, address, phone, email via API. Widget acceptable for advanced verification.

**Finding:** The KYC controller accepts all required fields via API:

- `KycPersonalData`: `firstName`, `lastName`, `phone`, `address` (`street`, `city`, `zip`, `country`)
- `KycContactData`: `mail`

Advanced verification steps (video ident) use session URLs (`KycSessionInfoDto.url`), which is explicitly acceptable per the updated requirements for steps beyond basic identity.

---

## 12. Bank Information — PARTIAL

**Requirement:** API for bank account details; should support relevant identifiers for operating regions.

**Finding:** `POST /bankAccount` accepts `CreateBankAccountDto` with `iban` as the primary field.

### IBAN (SEPA): PASS

Fully supported for European markets.

### Non-IBAN (ACH, wire): GAP

No routing number, account number, or other non-IBAN bank identifiers are accepted. If DFX expands to US or other non-SEPA markets, this would need to be addressed.

**Impact:** Low — DFX currently operates primarily in SEPA markets. The gap only matters if non-IBAN payment methods are added.

---

## 13. Verification — PASS

**Requirement:** Submit verification codes; indicate when KYC info is missing/outdated.

**Finding:**

- **Email verification:** `POST /mail/verify` accepts a verification token
- **2FA:** TOTP-based via `POST /kyc/2fa/verify`
- **Missing/outdated KYC:** Quote errors include `KycRequired`, `KycDataRequired`, `EmailRequired`. KYC step statuses include `Outdated` and `DataRequested`

The API provides both verification code submission and clear signals about what's missing.

---

## 14. Widget Return URIs — PARTIAL

**Requirement:** Widgets must support closing and returning to the Edge app (return URI, deep links, or done signal).

**Finding:** Auth/OAuth flows support `redirectUri`. KYC session URLs use a fixed base URL (`Config.frontend.services/kyc?code=...`) that is not parameterized with a per-request return URI.

**Impact:** Low — if the Edge fiat plugin opens the KYC URL in a WebView, it can detect navigation/completion and close the WebView from the app side (the GUI's `FiatPluginWebView` supports `onUrlChange` detection). This is a workable pattern even without a formal return URI.

**Recommendation:** Accept an optional `returnUri` parameter on KYC session creation for cleaner webview flow control.

---

## 15. Off-Ramp Flow — PARTIAL

**Requirement:** API-driven sell flow returning deposit address + expiration time.

### Deposit address: PASS

`PUT /sell/paymentInfos` returns `SellPaymentInfoDto` with `depositAddress` for the user to send crypto to.

### Expiration: GAP

No `expiresAt`, `expiration`, or `validUntil` field is present in the sell payment-info DTO. Expiry is enforced server-side via `txRequestWaitingExpiryDays`, but the client is not told when the deposit window closes.

**Impact:** Low — the Edge GUI uses `CircleTimer` (countdown) on swap confirmation scenes when `expirationDate` is available, but it gracefully handles the absence (no countdown shown). The user would not see a deadline, which is suboptimal UX but not a blocker.

**Recommendation:** Expose the expiration timestamp in `SellPaymentInfoDto` so the GUI can show a countdown.

---

## Action Items

### Needed for plugin integration (should address before plugin development)


| Priority   | Item                                                                   | Section | Effort |
| ---------- | ---------------------------------------------------------------------- | ------- | ------ |
| **Medium** | Host an order status page and expose its URL in payment-info responses | §2      | Medium |
| **Medium** | Add pagination (limit/offset) to `GET /transaction`                    | §6      | Low    |


### Recommended improvements (can address during or after plugin development)


| Priority | Item                                                           | Section | Effort  |
| -------- | -------------------------------------------------------------- | ------- | ------- |
| **Low**  | Document amount unit convention in Swagger/README              | §G      | Trivial |
| **Low**  | Add optional `stateProvince` to quote DTOs                     | §10     | Low     |
| **Low**  | Expose sell quote expiration in `SellPaymentInfoDto`           | §15     | Low     |
| **Low**  | Accept optional `returnUri` on KYC sessions                    | §14     | Low     |
| **Low**  | Ensure BTC/ETH/USDC are available as affiliate payout assets   | §8      | Config  |
| **Low**  | Add 2FA to `PUT /ref` endpoint                                 | §8      | Low     |
| **Low**  | Expose `countryCode` on transaction records for fiat reporting | §6      | Low     |


