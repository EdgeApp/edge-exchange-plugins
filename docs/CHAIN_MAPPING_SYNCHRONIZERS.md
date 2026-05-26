# Chain Mapping Synchronizers

This guide explains how to set up automated synchronization for your exchange plugin's chain code mappings using the `mapctl` infrastructure.

## Overview

The synchronizer system automatically fetches supported chains from your exchange provider's API and keeps the mapping files up-to-date. This is useful for providers with frequently changing chain support.

**If your provider has stable chain support**, you may prefer to manually maintain a static mapping file instead. See [Creating an Exchange Plugin - Step 3](./CREATING_AN_EXCHANGE_PLUGIN.md#step-3-chain-code-mapping) for static mapping setup.

## Architecture

The synchronizer infrastructure has these components:

```
scripts/
├── mapctl.ts                           # CLI tool
├── mapctlConfig.ts                     # API key configuration
├── mappings/
│   └── {provider}Mappings.ts           # Source mappings (provider → Edge)
├── synchronizers/
│   └── {provider}/
│       ├── {provider}Synchronizer.ts   # Fetches chains from provider API
│       └── {provider}Types.ts          # API response types
└── types.ts                            # SwapSynchronizer interface

src/mappings/
└── {provider}.ts                       # Auto-generated (Edge → provider)
```

## Creating a Synchronizer

### Step 1: Create the Types File

Create `scripts/synchronizers/yourplugin/yourpluginTypes.ts` with cleaners for your provider's API responses:

```typescript
import { asArray, asObject, asString } from 'cleaners'

export const asYourPluginChain = asObject({
  code: asString,
  name: asString
})

export const asYourPluginChainsResponse = asArray(asYourPluginChain)
```

### Step 2: Create the Synchronizer

Create `scripts/synchronizers/yourplugin/yourpluginSynchronizer.ts`. This implements the [SwapSynchronizer interface](#swapsynchronizer-interface) which defines how to fetch chain codes from your provider's API.

```typescript
import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asYourPluginChainsResponse } from './yourpluginTypes'

// Unique identifier for this synchronizer - must match the exported map name
const NAME = 'yourplugin'

// Your provider's API endpoint that returns supported chains
const YOURPLUGIN_API_URL = 'https://api.yourplugin.com/v1/chains'

export const makeYourPluginSynchronizer = (
  config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: NAME,

    // Loads existing mappings from the source file (or empty Map if file doesn't exist)
    get map() {
      return loadMappingFile(NAME)
    },

    // Path where mapctl will write the updated source mapping file
    mappingFilePath: getMappingFilePath(NAME),

    // Fetches all supported chain codes from your provider's API.
    // Called by `npm run mapctl sync-providers yourplugin`.
    async fetchChainCodes(): Promise<FetchChainCodeResult[]> {
      const response = await fetch(YOURPLUGIN_API_URL, {
        headers: {
          'Authorization': `Bearer ${config.YOURPLUGIN_API_KEY}`
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch chains: ${response.statusText}`)
      }

      const json = await response.json()
      const chains = asYourPluginChainsResponse(json)

      // Return chain codes with optional metadata (added as comments in the mapping file)
      return chains.map(chain => ({
        chainCode: chain.code,
        metadata: { 'Display Name': chain.name }
      }))
    }
  }
}
```

The `loadMappingFile` and `getMappingFilePath` utilities handle the boilerplate of loading existing mappings and determining file paths.

### Step 3: Register the Synchronizer

Add your synchronizer to [`scripts/allSynchronizers.ts`](../scripts/allSynchronizers.ts):

```typescript
import { makeYourPluginSynchronizer } from './synchronizers/yourplugin/yourpluginSynchronizer'

export const synchronizers: SwapSynchronizer[] = [
  // ... existing synchronizers
  makeYourPluginSynchronizer(config)
]
```

### Step 4: Add API Key Configuration (if needed)

If your provider requires an API key, add it to [`scripts/mapctlConfig.ts`](../scripts/mapctlConfig.ts):

```typescript
const asMapctlConfig = asObject({
  // ... existing keys
  YOURPLUGIN_API_KEY: asOptional(asString, '')
})
```

Then add your key to `mapctlConfig.json` (not committed to git):

```json
{
  "YOURPLUGIN_API_KEY": "your-api-key-here"
}
```

## Using mapctl Commands

### Sync Provider Chains

Fetch the latest chain data from your provider's API and create/update the source mapping:

```bash
npm run mapctl sync-providers yourplugin
```

This creates `scripts/mappings/yourpluginMappings.ts` (or updates it if it exists). The generated file looks like:

```typescript
import { EdgeCurrencyPluginId } from '../../src/util/edgeCurrencyPluginIds'

export const yourplugin = new Map<string, EdgeCurrencyPluginId | null>()
// Display Name: Arbitrum
yourplugin.set('ARBITRUM', 'arbitrum')

// Display Name: Avalanche
yourplugin.set('AVAX_CCHAIN', 'avalanche')

// Display Name: Some New Chain
yourplugin.set('NEWCHAIN', null)  // <-- New chains default to null
```

**Important**: New chains from the API are added with `null` values. After syncing, review the file and map any new chain codes to their corresponding Edge plugin IDs. Check `src/util/edgeCurrencyPluginIds.ts` for available plugin IDs.

### Generate Runtime Mappings

After updating source mappings, regenerate the inverted runtime mappings:

```bash
npm run mapctl update-mappings
```

This generates `src/mappings/yourplugin.ts` which maps Edge plugin IDs → provider chain codes.

### Add a New Plugin ID

When Edge adds support for a new blockchain:

```bash
npm run mapctl add-plugin mynewchain
```

This adds the plugin ID to `edgeCurrencyPluginIds.ts` and updates all generated mapping files in `src/mappings/` with `null` for the new plugin ID.

The tool uses a **Levenshtein distance algorithm** to suggest similar chain codes from each provider that might match the new plugin ID:

```
======================================================================
⚠️  IMPORTANT: New plugin ID 'mynewchain' has been added
======================================================================

The new plugin ID has been added to all generated mapping files
with a value of `null`. You must now update the source mapping files
for each provider that supports this network.

💡 Similar provider chain codes found (potential mappings):

   rango:
      1. "MYCHAIN" (85% similar)
      2. "NEWCHAIN" (70% similar)

   lifi:
      1. "myc" (75% similar)

   changenow:
      1. "MYC" (80% similar)
      2. "MYNEW" (65% similar)

To update mappings:
  1. Edit scripts/mappings/<provider>Mappings.ts
  2. Add mappings for provider chain codes that correspond to this plugin ID
  3. Run: npm run mapctl update-mappings
======================================================================
```

Review the suggestions and update each provider's source mapping file (`scripts/mappings/<provider>Mappings.ts`) to map the matching chain codes to the new plugin ID, then run `npm run mapctl update-mappings` to regenerate the runtime mappings.

## SwapSynchronizer Interface

```typescript
interface SwapSynchronizer {
  /** Provider name (e.g., 'rango', 'lifi') */
  name: string

  /** Current source mappings (provider chain code → Edge plugin ID) */
  map: Map<string, EdgeCurrencyPluginId | null>

  /** Path to the source mapping file */
  mappingFilePath: string

  /** Fetch chain codes from the provider API */
  fetchChainCodes(): Promise<ChainCodeResult[]>
}

interface ChainCodeResult {
  /** The provider's chain code */
  chainCode: string

  /** Optional metadata (e.g., display name) - added as comments */
  metadata?: Record<string, string>
}
```

## Examples

See existing synchronizers for reference implementations:

- [`scripts/synchronizers/rango/`](../scripts/synchronizers/rango/) - REST API example
- [`scripts/synchronizers/lifi/`](../scripts/synchronizers/lifi/) - GraphQL-style example
- [`scripts/synchronizers/thorchain/`](../scripts/synchronizers/thorchain/) - Blockchain-based provider

## Troubleshooting

**Synchronizer not found**: Ensure you've registered it in `mapctl.ts`

**API key errors**: Check `mapctlConfig.json` has the correct key

**Missing chains after sync**: New chains are added with `null` values. Edit the source mapping to add the Edge plugin ID mapping.

**Runtime mapping not updated**: Run `npm run mapctl update-mappings` after editing source mappings

