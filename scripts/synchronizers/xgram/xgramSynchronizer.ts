import fs from 'fs'
import path from 'path'

import { EdgeCurrencyPluginId } from '../../../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'

const MAPPING_FILE_PATH = path.join(
  __dirname,
  '../../mappings/xgramMappings.ts'
)

export const makeXgramSynchronizer = (
  _config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: 'xgram',
    get map(): Map<string, EdgeCurrencyPluginId | null> {
      if (fs.existsSync(MAPPING_FILE_PATH)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { xgram } = require('../../mappings/xgramMappings')
        return xgram
      }
      return new Map()
    },
    mappingFilePath: MAPPING_FILE_PATH,
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      return []
    }
  }
}
