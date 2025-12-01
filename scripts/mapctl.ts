import fs from 'fs'
import path from 'path'

import {
  EdgeCurrencyPluginId,
  edgeCurrencyPluginIds
} from '../src/util/edgeCurrencyPluginIds'
import { config } from './mapctlConfig'
import { makeChangeHeroSynchronizer } from './synchronizers/changehero/changeheroSynchronizer'
import { makeChangeNowSynchronizer } from './synchronizers/changenow/changenowSynchronizer'
import { makeExolixSynchronizer } from './synchronizers/exolix/exolixSynchronizer'
import { makeGodexSynchronizer } from './synchronizers/godex/godexSynchronizer'
import { makeLetsExchangeSynchronizer } from './synchronizers/letsexchange/letsexchangeSynchronizer'
import { makeLifiSynchronizer } from './synchronizers/lifi/lifiSynchronizer'
import { makeMayaProtocolSynchronizer } from './synchronizers/mayaprotocol/mayaprotocolSynchronizer'
import { makeRangoSynchronizer } from './synchronizers/rango/rangoSynchronizer'
import { makeSideShiftSynchronizer } from './synchronizers/sideshift/sideshiftSynchronizer'
import { makeSwapKitSynchronizer } from './synchronizers/swapkit/swapkitSynchronizer'
import { makeSwapuzSynchronizer } from './synchronizers/swapuz/swapuzSynchronizer'
import { makeThorchainSynchronizer } from './synchronizers/thorchain/thorchainSynchronizer'
import { SwapSynchronizerFactory } from './types'
import { findSimilar } from './util/stringSimilarity'

const OUTPUT_MAPPINGS_DIR = path.join(__dirname, '../src/mappings')

const synchronizerFactories: SwapSynchronizerFactory[] = [
  makeChangeHeroSynchronizer,
  makeChangeNowSynchronizer,
  makeExolixSynchronizer,
  makeGodexSynchronizer,
  makeLetsExchangeSynchronizer,
  makeLifiSynchronizer,
  makeMayaProtocolSynchronizer,
  makeRangoSynchronizer,
  makeSideShiftSynchronizer,
  makeSwapKitSynchronizer,
  makeSwapuzSynchronizer,
  makeThorchainSynchronizer
]

const SCRIPTS_MAPPINGS_DIR = path.join(__dirname, 'mappings')

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command == null || command === '') {
    showUsage()
    return
  }

  if (command === 'sync-providers') {
    const filter = args[1] != null && args[1] !== '' ? args[1] : undefined
    await syncSynchronizers(filter)
  } else if (command === 'update-mappings') {
    await updateMappings()
  } else if (command === 'add-plugin') {
    await addPluginId(args[1])
  } else {
    console.error(`Unknown command: ${command}`)
    showUsage()
    process.exit(1)
  }
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

async function syncSynchronizers(filter?: string): Promise<void> {
  const synchronizers = synchronizerFactories.map(f => f(config))
  const filteredSynchronizers =
    filter != null
      ? synchronizers.filter(s => s.name === filter)
      : synchronizers

  if (filter != null && filteredSynchronizers.length === 0) {
    console.error(`\nSynchronizer "${filter}" not found.`)
    console.log('\nAvailable synchronizers:')
    synchronizers.forEach(s => {
      console.log(`  - ${s.name}`)
    })
    return
  }

  console.log('Syncing synchronizers...')

  // Ensure scripts/mappings directory exists
  if (!fs.existsSync(SCRIPTS_MAPPINGS_DIR)) {
    fs.mkdirSync(SCRIPTS_MAPPINGS_DIR, { recursive: true })
  }

  for (const synchronizer of filteredSynchronizers) {
    console.log(`\nProcessing ${synchronizer.name}...`)
    const results = await synchronizer.fetchChainCodes()
    const resultChainCodes = new Set(results.map(r => r.chainCode))

    // Build combined map: results + existing non-null mappings
    const combinedMap = new Map<string, EdgeCurrencyPluginId | null>()
    const networkMetadata = new Map<string, Record<string, string>>()

    // Add all results (these are the source of truth)
    let newEntriesCount = 0
    for (const { chainCode, metadata } of results) {
      const existingMapping = synchronizer.map.get(chainCode)
      combinedMap.set(chainCode, existingMapping ?? null)
      if (!synchronizer.map.has(chainCode)) {
        newEntriesCount++
      }
      if (metadata != null && Object.keys(metadata).length > 0) {
        networkMetadata.set(chainCode, metadata)
      }
    }

    // Add existing non-null mappings that aren't in results (preserve them)
    let removedEntriesCount = 0
    for (const [key, value] of synchronizer.map.entries()) {
      if (!resultChainCodes.has(key)) {
        if (value == null) {
          removedEntriesCount++
        } else {
          // Preserve non-null mappings even if not in results
          combinedMap.set(key, value)
        }
      }
    }

    const sortedKeys = Array.from(combinedMap.keys()).sort((a, b) =>
      a.localeCompare(b)
    )

    const setCalls = sortedKeys
      .map((key, index) => {
        const val = combinedMap.get(key)
        const valStr = val == null ? 'null' : `'${val}'`

        const comments: string[] = []
        if (synchronizer.map.has(key) && !resultChainCodes.has(key)) {
          comments.push(
            '// WARNING: Not included by the synchronizer synchronization'
          )
        }

        const meta = networkMetadata.get(key)
        if (meta != null) {
          Object.entries(meta)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([k, v]) => {
              comments.push(`// ${k}: ${String(v)}`)
            })
        }

        const prefix = index > 0 ? '\n' : ''
        const commentStr = comments.length > 0 ? comments.join('\n') + '\n' : ''
        return `${prefix}${commentStr}${synchronizer.name}.set('${key}', ${valStr})`
      })
      .join('\n')

    const fileContent = `import { EdgeCurrencyPluginId } from '../../src/util/edgeCurrencyPluginIds'

export const ${synchronizer.name} = new Map<string, EdgeCurrencyPluginId | null>()
${setCalls}
`

    fs.writeFileSync(synchronizer.mappingFilePath, fileContent)

    const logMessage = `Saved ${synchronizer.name}Mappings.ts with ${newEntriesCount} new entries`
    if (removedEntriesCount > 0) {
      console.log(`${logMessage} and ${removedEntriesCount} removed entries.`)
    } else {
      console.log(`${logMessage}.`)
    }
  }
}

async function addPluginId(id: string): Promise<void> {
  if (id == null || id === '') {
    console.error('Please provide a plugin ID to add.')
    return
  }
  if (edgeCurrencyPluginIds.includes(id as any)) {
    console.log(`Plugin ID '${id}' already exists.`)
    return
  }

  const filePath = path.join(__dirname, '../src/util/edgeCurrencyPluginIds.ts')
  const content = fs.readFileSync(filePath, 'utf8')

  // Extract the array content and add the new ID
  const pluginIdsArray = [...edgeCurrencyPluginIds, id]
  // Sort alphabetically
  pluginIdsArray.sort((a, b) => {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })

  // Find the array start and end
  const arrayStartMatch = content.match(
    /export const edgeCurrencyPluginIds = \[/
  )
  // Look for '] as const' - find where it ends
  const arrayEndMatch = content.match(/\]\s*as const/)

  if (arrayStartMatch == null || arrayEndMatch == null) {
    console.error('Could not parse edgeCurrencyPluginIds.ts')
    return
  }

  const arrayStartIndex =
    (arrayStartMatch.index ?? 0) + arrayStartMatch[0].length
  const arrayEndIndex = (arrayEndMatch.index ?? 0) + arrayEndMatch[0].length

  const beforeArray = content.slice(0, arrayStartIndex)
  // Preserve everything after '] as const' (including the type export)
  const afterArray = content.slice(arrayEndIndex)

  // Generate the sorted array content with 'as const'
  const arrayContent =
    pluginIdsArray.map(pid => `  '${pid}'`).join(',\n') + '\n] as const'

  const newContent = beforeArray + '\n' + arrayContent + afterArray

  fs.writeFileSync(filePath, newContent)
  console.log(
    `Added '${id}' to edgeCurrencyPluginIds.ts (sorted alphabetically)`
  )

  // Use the array we already created (it's already sorted and includes the new ID)
  const updatedPluginIds = pluginIdsArray as EdgeCurrencyPluginId[]

  // Update all generated mapping files to include the new plugin ID
  console.log(
    '\nUpdating all provider mappings to include the new plugin ID...'
  )
  await updateMappings(updatedPluginIds)

  // Find similar keys per provider
  // Use a very high threshold (1.0 = 100% different) to always show top matches
  const providerSuggestions = new Map<
    string,
    Array<{ value: string; similarity: number }>
  >()
  for (const factory of synchronizerFactories) {
    const synchronizer = factory(config)
    const providerKeys = Array.from(synchronizer.map.keys())
    // Always show top 5 most similar matches, regardless of similarity score
    const suggestions = findSimilar(id, providerKeys, 5, 1.0)
    providerSuggestions.set(synchronizer.name, suggestions)
  }

  console.log('\n' + '='.repeat(70))
  console.log(`⚠️  IMPORTANT: New plugin ID '${id}' has been added`)
  console.log('='.repeat(70))
  console.log(
    '\nThe new plugin ID has been added to all generated mapping files'
  )
  console.log(
    'with a value of `null`. You must now update the source mapping files'
  )
  console.log('for each provider that supports this network.\n')

  // Check if any provider has suggestions
  const hasAnySuggestions = Array.from(providerSuggestions.values()).some(
    suggestions => suggestions.length > 0
  )

  if (hasAnySuggestions) {
    console.log('💡 Similar provider chain codes found (potential mappings):')
    console.log('')
  } else {
    console.log('💡 Checking for similar provider chain codes...')
    console.log('')
  }

  // Always show all providers with their most similar matches
  for (const factory of synchronizerFactories) {
    const synchronizer = factory(config)
    const suggestions = providerSuggestions.get(synchronizer.name) ?? []
    console.log(`   ${synchronizer.name}:`)
    if (suggestions.length > 0) {
      suggestions.forEach((match, index) => {
        const similarityPercent = Math.round((1 - match.similarity) * 100)
        console.log(
          `      ${index + 1}. "${match.value}" (${similarityPercent}% similar)`
        )
      })
    } else {
      // This should rarely happen, but handle empty provider keys case
      console.log('      (no chain codes found in mapping file)')
    }
    console.log('')
  }

  console.log('\nTo update mappings:')
  console.log('  1. Edit scripts/mappings/<provider>Mappings.ts')
  console.log(
    '  2. Add mappings for provider chain codes that correspond to this plugin ID'
  )
  console.log('  3. Run: yarn mapctl update-mappings')
  console.log('\n' + '='.repeat(70))
}

async function updateMappings(
  pluginIdsOverride?: EdgeCurrencyPluginId[]
): Promise<void> {
  console.log('Updating inverted mappings...')

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_MAPPINGS_DIR)) {
    fs.mkdirSync(OUTPUT_MAPPINGS_DIR, { recursive: true })
  }

  // Use override if provided (e.g., after adding a new plugin ID), otherwise use imported list
  const pluginIdsToUse = pluginIdsOverride ?? edgeCurrencyPluginIds

  // Process each synchronizer
  for (const factory of synchronizerFactories) {
    const synchronizer = factory(config)

    try {
      // Build inverted mapping: pluginId -> synchronizer network ID
      const invertedMap = new Map<string, string | null>()

      synchronizer.map.forEach((pluginId, synchronizerNetworkId) => {
        if (pluginId != null) {
          // If this pluginId already exists, we might have a conflict
          // For now, we'll use the first one we encounter
          if (!invertedMap.has(pluginId)) {
            invertedMap.set(pluginId, synchronizerNetworkId)
          }
        }
      })

      // Include ALL plugin IDs, setting unmapped ones to null
      const sortedPluginIds = [...pluginIdsToUse].sort((a, b) => {
        if (a < b) return -1
        if (a > b) return 1
        return 0
      })

      // Generate the output file content
      const setCalls = sortedPluginIds
        .map(pluginId => {
          const synchronizerNetworkId = invertedMap.get(pluginId)
          const valStr =
            synchronizerNetworkId == null || synchronizerNetworkId === ''
              ? 'null'
              : `'${synchronizerNetworkId}'`
          return `${synchronizer.name}.set('${pluginId}', ${valStr})`
        })
        .join('\n')

      const fileContent = `/**
 * ⚠️ AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY ⚠️
 *
 * This file is automatically generated from scripts/mappings/${synchronizer.name}Mappings.ts
 * To regenerate this file, run: yarn mapctl update-mappings
 *
 * To edit mappings:
 * 1. Edit scripts/mappings/${synchronizer.name}Mappings.ts
 * 2. Run: yarn mapctl update-mappings
 *
 * This file maps EdgeCurrencyPluginId -> synchronizer network identifier (or null)
 */

import { EdgeCurrencyPluginId } from '../util/edgeCurrencyPluginIds'

export const ${synchronizer.name} = new Map<EdgeCurrencyPluginId, string | null>()
${setCalls}
`

      const outputPath = path.join(
        OUTPUT_MAPPINGS_DIR,
        `${synchronizer.name}.ts`
      )
      fs.writeFileSync(outputPath, fileContent)
      const mappedCount = Array.from(invertedMap.values()).filter(
        v => v != null && v !== ''
      ).length
      console.log(
        `Saved ${synchronizer.name}.ts with ${
          sortedPluginIds.length
        } entries (${mappedCount} mapped, ${
          sortedPluginIds.length - mappedCount
        } null).`
      )
    } catch (e: any) {
      console.error(`Error processing ${synchronizer.name}:`, e.message)
    }
  }
}

function showUsage(): void {
  console.log(`
Usage: yarn mapctl <command> [options]

Commands:
  sync-providers [synchronizer]   Sync network mappings from all synchronizers (or specific synchronizer)
  update-mappings                 Generate inverted mappings (pluginId -> synchronizer network ID)
  add-plugin <id>                 Add a new plugin ID to edgeCurrencyPluginIds.ts (sorted alphabetically)

Examples:
  yarn mapctl sync-providers
  yarn mapctl sync-providers godex
  yarn mapctl update-mappings
  yarn mapctl add-plugin mynewplugin
`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
