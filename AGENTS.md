# AGENTS.md

## What this is

Swap plugins for [`edge-core-js`](https://github.com/EdgeApp/edge-core-js). Each plugin adapts one third-party provider (a CEX bridge or an on-chain DEX/aggregator) to the `EdgeSwapPlugin` interface, so the Edge wallet can quote and execute a swap through any provider uniformly. The core requests a quote from every enabled plugin at once and ranks the results, which is why the error contract below is load-bearing rather than cosmetic.

TypeScript, transpiled with `sucrase`, type-checked by `tsc`, tested with `mocha` under `nyc`. A plugin ships only once it is registered in `src/index.ts`.

## Commands

| Task | Command |
|---|---|
| Full verification (run before a PR) | `npm run verify` (prepare + lint + types + test) |
| Types / lint / tests | `npm run types` / `npm run lint` (`fix` to autofix) / `npm run test` |
| A single test file | `npx nyc mocha 'test/<name>.test.ts'` |
| Regenerate a provider's chain map | `npm run mapctl` |

`nyc` is what supplies the `sucrase/register` hook (it lives in `.nycrc.json`), so plain `npx mocha` cannot load TypeScript. Only `test/**/*.test.ts` runs in the suite; other `.ts` files under `test/` are manual integration harnesses.

## Plugin model

Two directories, split by VENUE, which is what `isDex` records:

- **Central** (`src/swap/central/`, `isDex: false`) — a server-gated venue that can refuse an order: it signs the payload, screens the user, or both. Reference: `sideshift.ts`.
- **DeFi** (`src/swap/defi/`, `isDex: true`) — a permissionless on-chain venue. Reference: `lifi.ts`.

The PAYLOAD shape is independent of the split, so never infer one from the other. A central provider may return executable calldata rather than a deposit address (`central/swapsxyz.ts` dispatches calldata, an unsigned Solana transaction, or a deposit address off one `vmId` switch). Classify by whether the venue can refuse you, not by whether defi appears in the implementation.

Start from the closest existing plugin of the right shape rather than from blank. Every plugin is a `makeXxxPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin` factory returning `{ swapInfo, fetchSwapQuote }`.

`fetchSwapQuote` follows one pipeline in every plugin: `convertRequest` → gate the pair (typed error if unsupported) → `getMaxSwappable` for `quoteFor: 'max'` → an inner function returning a `SwapOrder` → `makeSwapPluginQuote`. The shared machinery is in `src/util/swapHelpers.ts` and `src/util/utils.ts`.

Validate every network response with `cleaners`; never index into raw JSON. Keep the response-to-spend translation in a pure exported helper so it is unit-testable without a wallet or network (`makeSwapsXyzSpendInfo` in `swapsxyz.ts` is the pattern).

## Errors

The core ranks errors across providers to choose the message the user sees, so the type carries meaning:

| Condition | Throw |
|---|---|
| Unsupported pair, unmapped chain, same-asset, unroutable token | `SwapCurrencyError(swapInfo, request)` |
| Below the provider minimum | `SwapBelowLimitError(swapInfo, nativeMin?, 'from')` |
| Above the provider maximum | `SwapAboveLimitError(swapInfo, nativeMax?, 'from')` |
| Region / KYC block | `SwapPermissionError(swapInfo, 'geoRestriction' \| 'noVerification')` |

Typed errors are for **expected, user-facing swap conditions only**. An unexpected or unclassifiable failure (malformed response, transport error, unrecognized provider error code) throws a plain `Error`, which is intentionally unranked so an internal fault cannot masquerade as "currency unsupported" and beat a real provider's quote. Populate `nativeMin`/`nativeMax` only from structured provider limits; pass `undefined` rather than inventing a number.

## Chain mappings

`src/mappings/<provider>.ts` maps Edge `pluginId`s to the provider's own chain identifiers (`null` = unsupported). Central providers refresh theirs through a `mapctl` synchronizer; a small fixed set may be hand-written, but verify each entry against the provider's live API — a stale mapping fails silently at quote time, invisible to `tsc` and the tests.

## Testing

Two patterns, both without network:

- **Pure helper** — assert the response-to-spend translation directly. See `test/swapsxyz.test.ts`.
- **End-to-end through `fetchSwapQuote`** — drive the real plugin with a faked `io.fetchCors` and faked wallets (plain objects cast `as unknown as EdgeCurrencyWallet`, implementing only the fields the plugin touches), then assert the resulting error's `.name` or the built quote. See `test/nym.test.ts`, and the `fetchSwapQuote` blocks of `test/swapsxyz.test.ts`.

A new plugin ships with coverage of each typed error it can throw, plus one happy-path quote.

## Shipping a provider

A new provider also needs an `edge-reports` PR (transaction crediting) and an `edge-react-gui` PR (logos, `env.json` init options), per the [README](./README.md). GUI wiring only works once this package publishes. Add a `CHANGELOG.md` bullet under `## Unreleased` (`- added:` / `- changed:` / `- fixed:`) describing the user-visible effect.

## Further reading

- [`docs/CREATING_AN_EXCHANGE_PLUGIN.md`](./docs/CREATING_AN_EXCHANGE_PLUGIN.md) — step-by-step authoring guide: metadata, init options, mappings, quoting, amount conversion, error handling, response validation, registration.
- [`docs/API_REQUIREMENTS.md`](./docs/API_REQUIREMENTS.md) — the API contract a provider must meet before integration (asset identification, structured errors, quoting, status, reporting).
- [`docs/CHAIN_MAPPING_SYNCHRONIZERS.md`](./docs/CHAIN_MAPPING_SYNCHRONIZERS.md) — how the `mapctl` synchronizers work.
- [`.cursor/agents/`](./.cursor/agents) — review sub-agents encoding the review checklist for this repo.
