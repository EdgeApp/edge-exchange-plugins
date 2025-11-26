import { EdgeCurrencyPluginId } from '../src/util/edgeCurrencyPluginIds'
import { MapctlConfig } from './mapctlConfig'

export interface FetchChainCodeResult {
  chainCode: string
  metadata: Record<string, string>
}

export interface SwapSynchronizer {
  readonly name: string
  readonly map: Map<string, EdgeCurrencyPluginId | null>
  readonly mappingFilePath: string
  fetchChainCodes: () => Promise<FetchChainCodeResult[]>
}

export type SwapSynchronizerFactory = (config: MapctlConfig) => SwapSynchronizer
