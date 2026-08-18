# Bugbot Review Rules

## Swap plugin conventions

### Shared Guards Required (`shared-guards-required`)

In a central swap plugin, `fetchSwapQuote` must call `checkInvalidTokenIds` from `src/util/swapHelpers.ts` (it carries the same-asset guard and the default invalid-token list), even with an empty plugin-specific map. Flag any plugin that skips it, and any token-identity check that matches on Edge currency code instead of contract address.

### Native Amount Rounding (`native-amount-rounding`)

Any `denominationToNative` result used in an order, limit, or quote must be rounded to integer atomic units (`round(x, 0)`). Provider amounts carry more decimals than asset denominations; a plain `mul` yields fractional native values.

### Error Classification (`error-classification`)

`SwapCurrencyError` is only for genuinely unsupported pairs. Flag code that maps auth failures, rate limits, region refusals, or 5xx responses into it, and flag the same provider error kind mapped differently across the estimate, exchange, and range paths.

### Per-Endpoint Auth (`per-endpoint-auth`)

Flag authenticated headers sent to provider endpoints that reject them (some public catalog endpoints return 401 for ANY `X-API-KEY` value). Credentials go only to endpoints that require them.

### Empty Memo Is Absent (`empty-memo-absent`)

An empty-string memo / extra-id from a provider must be treated as absent, never emitted as an `EdgeMemo`.

### Catalog Cache Expiry (`catalog-cache-expiry`)

Provider catalog caches (supported assets, rate types) need an expiry or re-fetch-on-miss path. Flag lifetime-of-the-plugin caching justified by "these do not change"; providers rename and relist assets.

## Error handling

### Typed Catch Clauses (`typed-catch`)

Use `catch (error: unknown)`, never a bare `catch (error)`.

## Known-good patterns (do not flag)

### Cleaners `asOptional` Accepts Null (`asoptional-accepts-null`)

`asOptional` in the `cleaners` library tests `raw == null`, which covers JSON `null` as well as a missing key; a `null` value cleans to `undefined` without throwing. Do not flag `asOptional(...)` fields as rejecting `null`.

### Raw Error Logging Follows The Template (`template-error-logging`)

Logging cleaned upstream error payloads in `fetchSwapQuoteInner` follows `src/swap/central/template.ts` (step 8 of `docs/CREATING_AN_EXCHANGE_PLUGIN.md`), the repo-wide convention. Flag only secrets or PII in logs, not the pattern itself.
