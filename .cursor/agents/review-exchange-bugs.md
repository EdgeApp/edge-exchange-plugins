---
name: review-exchange-bugs
description: Reviews exchange plugins for common bugs and poor patterns. Use when reviewing any exchange plugin changes.
---

Review the branch/pull request for common bugs and poor patterns specific to Edge exchange plugins.

## Context Expected

You will receive:
- Repository name (edge-exchange-plugins)
- Branch name
- List of changed files to review

## How to Review

1. Read the changed plugin files provided in context
2. Check for each bug pattern listed below
3. Report findings with specific file:line references

---

## Separate Handlers for Different Asset Types

When adding support for a new asset type (like Zcash), create a separate handler block rather than extending existing UTXO logic:

```typescript
// Incorrect - mixing ZEC with general UTXO handling
} else {
  // UTXO block
  if (fromWallet.currencyInfo.pluginId === 'zcash') {
    // ZEC-specific code mixed in
  }
  // ... rest of UTXO handling
}

// Correct - separate block for ZEC
} else if (fromWallet.currencyInfo.pluginId === 'zcash') {
  // ZEC-specific handling with all necessary checks
  if (thorAddress == null) throw new SwapCurrencyError(...)
  if (fromTokenId != null) throw new SwapCurrencyError(...)
  // ... ZEC-specific logic
} else {
  // General UTXO handling
}
```

While Zcash is UTXO-based under the hood, Edge treats it differently. Keeping handlers separate makes code easier to maintain and reduces the chance of missing required checks.

---

## Include All Validation Checks in New Handlers

When creating a new asset handler by copying from an existing one, copy ALL validation checks:

```typescript
// UTXO block has token rejection check
} else {
  if (fromTokenId != null) {
    throw new SwapCurrencyError(swapInfo, request)
  }
  // ... rest of UTXO logic
}

// New ZEC block - MUST include the same check
} else if (fromWallet.currencyInfo.pluginId === 'zcash') {
  if (fromTokenId != null) {
    throw new SwapCurrencyError(swapInfo, request)  // Don't forget this!
  }
  // ... ZEC logic
}
```

Missing validation checks can allow unsupported swap types to proceed.

---

## Remove Invalid Destination When Adding Support

If a previous commit blocked swaps to an asset, remove that block when adding destination support:

```typescript
// Previous state: ZEC swaps blocked
INVALID_CURRENCY_CODES.to.zcash = ['ZEC']

// Adding ZEC receive support but forgetting to remove the block:
// New ZEC receive handler (lines 388-392) NEVER RUNS because
// checkInvalidCodes throws SwapCurrencyError first (lines 129-135)

// Correct: Remove the invalid code entry when adding support
// Delete: INVALID_CURRENCY_CODES.to.zcash = ['ZEC']
```

Always trace the swap flow to ensure new handlers are actually reachable.
