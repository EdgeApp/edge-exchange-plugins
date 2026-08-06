# Bugbot Review Rules

Standing conventions for swap plugins in this repo. Most entries exist because
the same finding was raised, and settled, on several separate provider PRs.

## Amounts

### Native Amounts Are Whole Integers (`native-amounts-are-integers`)

`denominationToNative` is a plain multiply, so a provider amount with more
decimals than the asset's denomination yields a fractional native string. Round
to whole atomic units before the value reaches `spendTargets`, swap metadata, or
a limit carried on a `SwapBelowLimitError` / `SwapAboveLimitError`.

```ts
// Bad:
const nativeMin = denominationToNative(wallet, limit.min, tokenId)

// Good:
const nativeMin = ceil(denominationToNative(wallet, limit.min, tokenId), 0)
```

### Round Limits Toward the Provider (`limit-rounding-direction`)

A minimum rounds **up**, a maximum or a receive amount rounds **down**. Rounding
the other way widens the range past what the provider accepts, or shows a
receive amount larger than what actually arrives.

### Never Assume a Documented Unit (`verify-amount-units`)

Provider docs are wrong about units often enough that a claim needs a live
response behind it. Decimal-vs-base-unit mistakes are silent whenever the pairs
used during development happen to return null limits.

### Use `biggystring`, Not Floats (`biggystring-not-floats`)

Applies to comparison and sorting too, not just arithmetic. `String(smallFloat)`
can produce scientific notation, which string comparison misreads.

```ts
// Bad:
quotes.sort((a, b) => b.amountOut - a.amountOut)

// Good:
quotes.sort((a, b) => (lt(a.amountOut, b.amountOut) ? 1 : gt(a.amountOut, b.amountOut) ? -1 : 0))
```

## Max Quotes

### The Max Probe Must Not Create an Order (`max-probe-no-order`)

`getMaxSwappable` invokes the plugin's quote function as a probe with the raw
balance, then the real quote runs again with the trimmed amount. If order
creation sits in that path, every max swap creates and abandons a live order.
Split quote fetching from order creation and probe with the quote-only path.

The split is visible in the cleaners: a response carrying `depositAddress` has
committed the provider. If the quote cleaner requires one, the quote call *is* an
order call and no arrangement of the code avoids the extra order. Check the
cleaner shapes, not just the comments and the call count.

Known accepted state: for a provider whose quote and order live behind a single
endpoint with no cancel, the abandoned order is inherent, not a plugin defect.
Raise it as a framework follow-up, not a per-plugin bug.

### The Max Probe Needs `skipChecks` (`max-probe-skip-checks`)

The probe's spend targets the user's own address, which EVM engines reject with
`SpendToSelfError` because the public key is the address. That error escapes
`getMaxSwappable` and fails every max swap from an EVM wallet.

```ts
// Good (probe spendInfo only):
skipChecks: true
```

### The Max Probe Must Not Throw Above-Limit (`max-probe-clamp-dont-throw`)

The probe deliberately quotes the full pre-fee balance to find the ceiling. An
above-limit balance must clamp through `getMaxSpendable`, not throw
`SwapAboveLimitError` and abort a swap that fits once fees are subtracted. Gate
the throw on a flag the probe passes as false.

## Errors and Limits

### Limit Errors Outrank Currency Errors (`limit-errors-outrank-currency`)

A limit failure whose code or message also names a token, path or route must
surface as `SwapBelowLimitError` / `SwapAboveLimitError`, not
`SwapCurrencyError`. `pickBestError` ranks by type, so a misclassification hides
the real amount from the user. When matching free text, match whole phrases: a
substring test for `LOW` also matches `ALLOWANCE`.

### Enforce Limits Against the Requested Amount (`limits-vs-requested-amount`)

Compare `request.nativeAmount`, never the amount echoed back in the quote. A
provider that silently clamps an out-of-range request returns an in-range echo,
so comparing the echo lets the swap proceed for less than the user asked.

### A Provider Outage Is Not an Unsupported Pair (`outage-is-not-unsupported`)

A non-OK status from an asset or token lookup must surface as a real error.
Converting it to `SwapCurrencyError` reports "unsupported pair" for a transient
failure and can poison pair-capability caching.

### Unquotable Pairs Are Currency Errors (`unquotable-pair-is-currency-error`)

The mirror case. When a mapped pair is one the provider cannot quote, throw
`SwapCurrencyError` so the GUI simply omits this provider, rather than a plain
`Error` that surfaces as a failed provider. Provider network codes go stale, so
mapped-but-unquotable is a steady state, not an edge case.

## Trust Boundary

### Bound Provider Amounts Before Signing (`bound-provider-amounts`)

Any provider-returned amount that becomes a signed spend or a token approval
must be bounded by the locally requested amount. Bound every field the spend
path consumes, not only the most obvious one, and compare each against a value
in its own units: a native fee in wei compared against a token amount in token
base units falsely rejects valid quotes.

### Never Persist a Partner URL (`no-partner-supplied-uri`)

Build `savedAction.orderUri` from a plugin constant plus the order id. A
partner-supplied `statusUrl` is rendered as a tappable link, so accepting its
host and scheme lets a compromised upstream steer users anywhere.

### Error-Body Logging Is the Repo Convention (`error-body-logging-is-conventional`)

`log.warn('<Provider> API error response:', text)` and the
`JSON.stringify(responseJson)` log on a cleaner failure are prescribed by
`src/swap/central/template.ts` and used by every central plugin. Do not flag them
as a per-plugin data-exposure defect; changing the convention is a repo-wide
decision.

## Cleaners

### Memos Must Survive Numbers and Blanks (`memo-cleaner-numeric-and-blank`)

Both failure modes silently send an untagged deposit, which loses funds on
memo-based chains. A numeric destination tag (including the valid tag `0`) fails
a string-only cleaner, and an empty string becomes an empty `EdgeMemo`.

```ts
// Bad:
payinExtraId: asMaybe(asString)

// Good:
payinExtraId: asOptionalBlank(asNumberString)
```

### Accept Numeric or String Error Codes (`error-codes-numeric-or-string`)

A provider that returns amounts as either number or string usually does the same
with error codes. `asNumberString` normalizes both, so classification does not
depend on which shape arrived.

### `asOptional` Already Treats Null as Absent (`asoptional-handles-null`)

In this repo's `cleaners` version, `asOptional(asString)` maps a JSON `null` to
`undefined` rather than throwing. `asEither(asString, asNull)` is only needed
when `null` and absent must stay distinguishable.

## Plugin Structure

### Call `checkInvalidTokenIds` (`call-check-invalid-token-ids`)

It carries both the repo-wide blocked list and the same-asset guard, so skipping
it opts out of every future entry added there. For a provider whose main flow is
legitimately same-asset, extend the helper rather than dropping the call.

### `isEstimate` Reports What Is Guaranteed (`isestimate-reflects-rate`)

Set it from whether the provider actually fixed the rate. Hardcoding `false`
shows a locked receive amount on a floating route.

### Clamp Expirations With `ensureInFuture` (`expiry-through-ensure-in-future`)

A provider `validUntil` can already be in the past from clock skew, which fails
the quote at approval time.

### Respect the Provider's Retry Window (`retry-window-is-a-floor`)

A local backoff cap must bound only our own doubling. Truncating a reported
`retryAfter` fires retries early and burns the provider's budget. A backoff that
would land past the quote's own expiry should fail as a rate limit immediately
rather than sleep through the window and then report an expired quote.

## Chain Mappings

### Chain Identity Claims Need Live Evidence (`chain-identity-needs-evidence`)

The highest false-positive area in this repo. A provider's chain id space
frequently reuses a number that means something else on EVM, and a provider can
list two networks under one ticker (an EOSIO chain and its EVM sibling). What
settles it is the provider's own chain metadata plus the shape of a real deposit
address, not the numeric id.

Before reporting a mapping as wrong, state the live evidence. Implementers:
record that evidence as a comment next to any non-obvious entry, so the same
question is not reopened on the next review.

### Unsupported Chains Map to `null` (`unsupported-chains-are-null`)

An explicit `null` documents "checked, not supported" and avoids a round trip.
Leaving a chain absent is indistinguishable from having forgotten it.
