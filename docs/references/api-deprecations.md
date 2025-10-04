# API Deprecations

**Date**: 2025-08-20

## Overview

This document tracks deprecated APIs in edge-core-js that are still used in the codebase. These should be migrated when possible.

## Deprecated APIs Currently in Use

### fetchCors

**Status**: Deprecated  
**Used in**: `src/swap/central/changehero.ts` (line 184)  
**Migration**: Use standard `fetch` API with appropriate CORS headers

### denominationToNative / nativeToDenomination

**Status**: Deprecated  
**Used extensively in**:

- `src/swap/central/changehero.ts` (multiple lines)
- Various other swap plugins

**Current usage example**:

```typescript
// Deprecated
const nativeAmount = denominationToNative(denominationAmount, currencyInfo);
const denominationAmount = nativeToDenomination(nativeAmount, currencyInfo);
```

**Migration path**: Use the new conversion utilities from edge-core-js when available.

## Migration Strategy

1. **Track deprecation warnings** during build/development
2. **Update incrementally** - migrate one plugin at a time
3. **Test thoroughly** - ensure numeric precision is maintained
4. **Coordinate with edge-core-js** updates

## Impact Assessment

### High Priority

- `denominationToNative` / `nativeToDenomination` - Used for critical amount calculations

### Medium Priority

- `fetchCors` - Can be replaced with standard fetch

## Testing Deprecation Fixes

When migrating deprecated APIs:

1. **Preserve exact numeric behavior** - Use test cases with known values
2. **Check edge cases** - Very large/small amounts, different decimal places
3. **Verify cross-plugin compatibility** - Ensure all plugins work together

## Notes

- Deprecation warnings appear as HINT messages during TypeScript compilation
- Some deprecations may require waiting for edge-core-js updates
- Always maintain backward compatibility during migration
