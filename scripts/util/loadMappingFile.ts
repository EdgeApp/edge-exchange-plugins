import fs from 'fs'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../src/util/edgeCurrencyPluginIds'

/**
 * Returns the path to a synchronizer's mapping file.
 *
 * @param name - The synchronizer name (e.g., 'rango', 'lifi')
 * @returns The absolute path to the mapping file
 */
export const getMappingFilePath = (name: string): string => {
  return path.join(__dirname, `../mappings/${name}Mappings.ts`)
}

/**
 * Lazily loads a mapping file if it exists, otherwise returns an empty Map.
 * This allows sync-providers to create the file on first run.
 *
 * @param name - The synchronizer name (e.g., 'rango', 'lifi')
 * @returns The mapping Map, or an empty Map if the file doesn't exist
 */
export const loadMappingFile = (
  name: string
): Map<string, EdgeCurrencyPluginId | null> => {
  const mappingFilePath = getMappingFilePath(name)

  if (fs.existsSync(mappingFilePath)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require(`../mappings/${name}Mappings`)
    return module[name]
  }
  return new Map()
}
