---
name: review-plugin-creation
description: Reviews exchange plugins for correct structure and conventions. Use when reviewing new plugins or significant plugin modifications.
---

Review the branch/pull request for correct plugin structure and conventions.

## Context Expected

You will receive:
- Repository name (edge-exchange-plugins)
- Branch name
- List of changed files to review

## How to Review

1. Read the plugin creation guide: `docs/CREATING_AN_EXCHANGE_PLUGIN.md`
2. Read the changed plugin files provided in context
3. Verify the plugin follows the documented structure and conventions
4. Report findings with specific file:line references

## Key Areas to Check

- Plugin metadata (`swapInfo` with correct fields)
- Init options with cleaners
- Quote fetching (address retrieval, quote directions, error mapping)
- Amount conversions using `denominationToNative`/`nativeToDenomination`
- Transaction info (`EdgeSpendInfo` or `MakeTxParams`)
- API response validation with cleaners
- Plugin registration in `src/index.ts`
- Correct plugin location (`src/swap/central/` vs `src/swap/defi/`)
