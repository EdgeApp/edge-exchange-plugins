---
name: review-edge-exchange-plugins
description: Orchestrator that launches exchange plugin review subagents. Use when reviewing exchange plugin implementations.
---

Review the branch/pull request for compliance with Edge exchange plugin conventions.

## Context Expected

You will receive:
- Repository name (edge-exchange-plugins)
- Branch name
- List of changed files to review

## Orchestration

Launch ALL FOUR sub-agents in parallel, passing them the full context you received:

1. **review-api-requirements** - Reviews for compliance with `docs/API_REQUIREMENTS.md`
2. **review-chain-mapping** - Reviews chain mapping with `docs/CHAIN_MAPPING_SYNCHRONIZERS.md`
3. **review-plugin-creation** - Reviews plugin structure with `docs/CREATING_AN_EXCHANGE_PLUGIN.md`
4. **review-exchange-bugs** - Reviews for common bugs and poor patterns

## Output

Collect findings from all sub-agents and consolidate into a single report organized by category:

- **API Requirements Issues** - From review-api-requirements
- **Chain Mapping Issues** - From review-chain-mapping
- **Plugin Structure Issues** - From review-plugin-creation
- **Bug Patterns** - From review-exchange-bugs

For each finding, include specific file:line references. Omit categories with no findings.
