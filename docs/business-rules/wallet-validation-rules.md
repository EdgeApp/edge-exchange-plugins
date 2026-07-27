# Wallet Validation Rules

**Date**: 2025-08-20

## Critical Business Rules

### Same Wallet Requirements

Several DEX plugins **must** use the same wallet for source and destination:

1. **XRP DEX** (`src/swap/defi/xrpDex.ts`)

   ```typescript
   // Source and dest wallet must be the same
   if (request.fromWallet !== request.toWallet) {
     throw new Error("XRP DEX must use same wallet for source and destination");
   }
   ```

2. **0x Gasless** (`src/swap/defi/0x/0xGasless.ts`)

   ```typescript
   // The fromWallet and toWallet must be of the same because the swap
   ```

3. **Fantom Sonic Upgrade** (`src/swap/defi/fantomSonicUpgrade.ts`)
   ```typescript
   if (fromAddress !== toAddress) {
     throw new Error("From and to addresses must be the same");
   }
   ```

### Chain Validation

Uniswap V2-based plugins validate that both wallets are on the same chain:

1. **TombSwap** (`src/swap/defi/uni-v2-based/plugins/tombSwap.ts`)
2. **SpookySwap** (`src/swap/defi/uni-v2-based/plugins/spookySwap.ts`)
   ```typescript
   // Sanity check: Both wallets should be of the same chain.
   ```

## Rationale

### DEX Same-Wallet Requirement

- DEX swaps happen in a single transaction on-chain
- The wallet executing the swap receives the output tokens
- Cross-wallet swaps would require additional transfer transactions

### Chain Validation

- Prevents accidental cross-chain swap attempts
- Ensures contract addresses are valid for the target chain
- Protects users from losing funds due to chain mismatches

## Implementation Guidelines

When implementing a new DEX plugin:

1. **Always validate wallet compatibility** early in `fetchSwapQuote`
2. **Throw descriptive errors** that explain the limitation
3. **Document the requirement** in the plugin's swapInfo

Example validation:

```typescript
async fetchSwapQuote(request: EdgeSwapRequest): Promise<EdgeSwapQuote> {
  // Validate same wallet requirement for DEX
  if (request.fromWallet !== request.toWallet) {
    throw new Error(`${swapInfo.displayName} requires same wallet for swap`)
  }

  // Continue with quote logic...
}
```

## Exceptions

Centralized exchange plugins (`/central/`) typically support cross-wallet swaps because:

- They use deposit addresses
- The exchange handles the actual swap
- Funds can be sent to any destination address
