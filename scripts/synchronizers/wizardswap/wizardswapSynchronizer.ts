import fetch from 'node-fetch'

import { MapctlConfig } from '../../mapctlConfig'
import { FetchChainCodeResult, SwapSynchronizer } from '../../types'
import { getMappingFilePath, loadMappingFile } from '../../util/loadMappingFile'
import { asWizardSwapCurrencyResponse } from './wizardswapTypes'

const NAME = 'wizardswap'

/**
 * WizardSwap has no tokens: every asset it lists is a mainnet coin identified by
 * a lowercase ticker, so the ticker IS the chain code.
 *
 * `GET /api/currency` is the authoritative list. `GET /api/pairs` names two more
 * tickers (`ada`, `onion`) that `/api/currency` omits, and a quote for one of
 * those is refused, so the pair list is not used here.
 *
 * WizardSwap's `firo` maps to Edge's `zcoin` currency plugin, which IS Firo
 * (assetDisplayName 'Firo', code FIRO). The names differ, so a re-sync cannot
 * match them by similarity and the mapping file carries the pair explicitly.
 */
export const makeWizardSwapSynchronizer = (
  _config: MapctlConfig
): SwapSynchronizer => {
  return {
    name: NAME,
    get map() {
      return loadMappingFile(NAME)
    },
    mappingFilePath: getMappingFilePath(NAME),
    fetchChainCodes: async (): Promise<FetchChainCodeResult[]> => {
      const response = await fetch('https://www.wizardswap.io/api/currency')

      if (!response.ok) {
        throw new Error(
          `Failed to fetch WizardSwap currencies: ${response.status} ${response.statusText}`
        )
      }

      // Every WizardSwap response is prefixed with a literal tab before the
      // JSON, so parse the text rather than trusting a strict JSON reader.
      const text = await response.text()
      const currencies = asWizardSwapCurrencyResponse(JSON.parse(text))

      if (currencies.length === 0) {
        throw new Error(
          'WizardSwap API returned 0 currencies. This likely indicates an API error.'
        )
      }

      return currencies.map(currency => ({
        chainCode: currency.symbol,
        metadata: {
          'Display Name': currency.name
        }
      }))
    }
  }
}
