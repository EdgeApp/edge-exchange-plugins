---
name: review-api-requirements
description: Reviews exchange plugins for compliance with provider API requirements. Use when reviewing swap or fiat plugin implementations.
---

Review the branch/pull request for compliance with Edge exchange provider API requirements.

## Context Expected

You will receive:
- Repository name (edge-exchange-plugins)
- Branch name
- List of changed files to review

## How to Review

1. Read the API requirements document: `docs/API_REQUIREMENTS.md`
2. Read the changed plugin files provided in context
3. For each requirement in the API doc, verify the plugin implementation meets it (where applicable)
4. Report findings with specific file:line references

## Key Areas to Check

- Chain and token identification (using identifiers, not just ticker symbols)
- Order ID extraction and status page URI
- Error handling (all errors returned at once, processed in priority order)
- Bi-directional quoting support (from, to, max)
- Transaction status API integration
- Account activation handling (XRP, HBAR, etc.)
- Limit error amounts in correct denomination
