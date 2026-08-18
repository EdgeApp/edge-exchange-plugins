# AGENTS.md

Swap-plugin library for Edge: every provider integration (centralized in `src/swap/central/`, on-chain DeFi in `src/swap/defi/`) plus the chain/token mapping layer in `src/mappings/`. Consumed by `edge-react-gui`; clone as a peer to it for integration testing.

## Commands

| Task | Command |
|---|---|
| Install | `npm install && npm run prepare` |
| Full verification (prepare, lint, types, test) | `npm run verify` |
| Mapping fixtures | `npm run mapctl` (see `docs/CHAIN_MAPPING_SYNCHRONIZERS.md`) |

## Integration invariants

These fail silently or only under production traffic, and every one has caused review findings on past plugin PRs:

- New central plugins start from `src/swap/central/template.ts` and follow `docs/CREATING_AN_EXCHANGE_PLUGIN.md`. Read `docs/API_REQUIREMENTS.md` before writing code.
- Call the shared guards in `src/util/swapHelpers.ts`: `fetchSwapQuote` must run `checkInvalidTokenIds` (same-asset guard plus the default invalid-token list) even with an empty plugin-specific map, matching the sibling central plugins.
- Token identity resolves by CONTRACT ADDRESS, never by Edge currency code. A native asset (no Edge contract address) requires the provider side to also have none; a provider listing must never be matched on ticker alone.
- Round every `denominationToNative` result to integer atomic units (`round(x, 0)`) before it reaches an order, limit, or quote. Provider amounts carry arbitrary decimals.
- Map provider failures to the typed swap errors precisely: `SwapCurrencyError` means "this pair is genuinely unsupported", never a bucket for auth failures, rate limits, region refusals, or 5xx. Map the same provider error kind identically across the estimate, exchange, and range paths.
- Empty-string memo / extra-id from a provider is absent; never emit an empty `EdgeMemo`.
- Send credentials per endpoint, not globally: some provider endpoints reject requests that carry the API key. Verify each endpoint's auth expectation against the live API.
- Provider catalog caches (supported assets, rate types) need an expiry or re-fetch-on-miss path; providers rename and relist assets.

## Docs index

- `docs/CREATING_AN_EXCHANGE_PLUGIN.md`: the end-to-end plugin walkthrough; open when adding a provider.
- `docs/API_REQUIREMENTS.md`: what a provider's API must support before integration starts.
- `docs/CHAIN_MAPPING_SYNCHRONIZERS.md`: how `src/mappings/` fixtures are generated and refreshed.
