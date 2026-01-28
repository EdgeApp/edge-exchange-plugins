---
name: review-chain-mapping
description: Reviews exchange plugins for correct chain mapping implementation. Use when reviewing plugins that add or modify chain support.
---

Review the branch/pull request for correct chain mapping implementation.

## Context Expected

You will receive:
- Repository name (edge-exchange-plugins)
- Branch name
- List of changed files to review

## How to Review

1. Read the chain mapping documentation: `docs/CHAIN_MAPPING_SYNCHRONIZERS.md`
2. Read the changed plugin and mapping files provided in context
3. Verify the mapping implementation follows the documented patterns
4. Report findings with specific file:line references

## Key Areas to Check

- Source mappings in `scripts/mappings/` (provider code → Edge plugin ID)
- Generated runtime mappings in `src/mappings/` (Edge plugin ID → provider code)
- Synchronizer implementation if adding a new provider
- New chains mapped correctly (not left as `null` without reason)
- EVM chains using `chainId` where applicable
- Mapping file imported and used correctly in plugin code
