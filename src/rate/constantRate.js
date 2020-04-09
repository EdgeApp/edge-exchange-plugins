// @flow

import {
  type EdgeCorePluginOptions,
  type EdgeRatePlugin
} from 'edge-core-js/types'

export function makeConstantRatePlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  return {
    rateInfo: {
      pluginId: 'constantRate',
      displayName: 'ConstantRate'
    },

    async fetchRates(pairsHint) {
      // Grab all the pairs which are in USD:
      const pairs = [
        {
          fromCurrency: 'TBTC',
          toCurrency: 'iso:USD',
          rate: 0.01
        },
        {
          fromCurrency: 'WETH',
          toCurrency: 'ETH',
          rate: 1
        },
        {
          fromCurrency: 'iso:BRL',
          toCurrency: 'BRZ',
          rate: 1
        },
        {
          fromCurrency: 'WBTC',
          toCurrency: 'BTC',
          rate: 1
        },
        {
          fromCurrency: 'iso:USD',
          toCurrency: 'FIO',
          rate: 0.001
        }
      ]
      return pairs
    }
  }
}
