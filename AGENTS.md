# Edge Exchange Plugins - Agent Guidelines

Swap and exchange-rate plugins loaded by `edge-core-js`. Each plugin adapts one
provider's API to the `EdgeSwapPlugin` interface: quote a pair, map the
provider's failures onto Edge's typed swap errors, and hand back a spend the
wallet can sign. Almost all of the difficulty is in that adaptation, not in the
HTTP calls.

## Commands

Use **npm** (this repo moved off yarn), and **mocha**, not jest.

| Command | What it does |
|---|---|
| `npm run verify` | Full check: `prepare`, `lint`, `types` (tsc), `test`. Run before every PR |
| `npm test` | `nyc mocha 'test/**/*.test.ts'` |
| `npm run types` | `tsc --noEmit` |
| `npm run fix` | `eslint --fix` (includes Prettier) |
| `npm run prepare` | Rebuilds `lib/` + the webpack bundle. Required before `edge-react-gui` can pick up a change |
| `npm run mapctl` | Chain-mapping synchronizer CLI, see the mapping doc below |

Branch off `master`, not `develop`.

## Where the code runs

Swap plugins execute inside **edge-core-js's plugin WebView**, not in the React
Native JS context. Metro's debugger and Hermes breakpoints cannot reach them, so
a change is verified by rebuilding the bundle (`npm run prepare`), linking it
into the app (`npm run updot edge-exchange-plugins` in `edge-react-gui`), and
reading plugin logs. Budget for that loop rather than expecting to step through.

## Amount units

The most expensive recurring bug class. Edge amounts (`nativeAmount`,
`spendTargets`, every limit carried on a swap error) are **integer native/atomic
units**. Provider APIs almost always speak **decimal denominated** amounts.

- Convert at the boundary with `nativeToDenomination` / `denominationToNative`
  from `src/util/swapHelpers.ts`, and round the result to a whole atomic unit.
  `denominationToNative` is a plain multiply, so it can return a fraction.
- Round a minimum **up** and a maximum or receive amount **down**, so no
  rounding widens the range the provider actually accepts.
- Do arithmetic with `biggystring`, never JS numbers. Amounts exceed float
  precision, and `String(smallFloat)` can produce scientific notation that
  string comparisons silently misread.
- Never assume a provider's documented unit. Several providers document base
  units and return decimals; check a live response.

## Starting a new provider

`src/swap/central/template.ts` is the starting point and is intentionally not
registered in `src/index.ts`, so it compiles but never loads. Its comments carry
the invariants that recur in review (the max-quote probe, the trust boundary on
provider-returned amounts, memo cleaning, limit direction). Copy it and keep the
comments for the constructs you keep.

`src/swap/central/nym.ts` is the closest reviewed reference implementation.

## Docs

- [`docs/CREATING_AN_EXCHANGE_PLUGIN.md`](./docs/CREATING_AN_EXCHANGE_PLUGIN.md) - build a plugin, plus the pre-PR checklist. Read before writing one
- [`docs/API_REQUIREMENTS.md`](./docs/API_REQUIREMENTS.md) - what a provider's API must offer. Read when evaluating a new provider or arguing a gap back to them
- [`docs/CHAIN_MAPPING_SYNCHRONIZERS.md`](./docs/CHAIN_MAPPING_SYNCHRONIZERS.md) - keeping `src/mappings/*` in sync with a provider's chain list
- [`.cursor/BUGBOT.md`](./.cursor/BUGBOT.md) - standing conventions for PR review on this repo
