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
          fromCurrency: 'TESTBTC',
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
        // AAVE tokens
        {
          fromCurrency: 'AYFI',
          toCurrency: 'YFI',
          rate: 1
        },
        {
          fromCurrency: 'ALINK',
          toCurrency: 'LINK',
          rate: 1
        },
        {
          fromCurrency: 'ADAI',
          toCurrency: 'DAI',
          rate: 1
        },
        {
          fromCurrency: 'ABAT',
          toCurrency: 'BAT',
          rate: 1
        },
        {
          fromCurrency: 'AWETH',
          toCurrency: 'WETH',
          rate: 1
        },
        {
          fromCurrency: 'AWBTC',
          toCurrency: 'WBTC',
          rate: 1
        },
        {
          fromCurrency: 'ASNX',
          toCurrency: 'SNX',
          rate: 1
        },
        {
          fromCurrency: 'AREN',
          toCurrency: 'REN',
          rate: 1
        },
        {
          fromCurrency: 'AUSDT',
          toCurrency: 'USDT',
          rate: 1
        },
        {
          fromCurrency: 'AMKR',
          toCurrency: 'MKR',
          rate: 1
        },
        {
          fromCurrency: 'AMANA',
          toCurrency: 'MANA',
          rate: 1
        },
        {
          fromCurrency: 'AZRX',
          toCurrency: 'ZRX',
          rate: 1
        },
        {
          fromCurrency: 'AKNC',
          toCurrency: 'KNC',
          rate: 1
        },
        {
          fromCurrency: 'AUSDC',
          toCurrency: 'USDC',
          rate: 1
        },
        {
          fromCurrency: 'ASUSD',
          toCurrency: 'SUSD',
          rate: 1
        },
        {
          fromCurrency: 'AUNI',
          toCurrency: 'UNI',
          rate: 1
        },
        // Deprecated tokens
        {
          fromCurrency: 'ANT',
          toCurrency: 'ANTV1',
          rate: 1
        },
        {
          fromCurrency: 'REPV2',
          toCurrency: 'REP',
          rate: 1
        },
        // FTM Frapped tokens
        {
          fromCurrency: 'FUSDT',
          toCurrency: 'USDT',
          rate: 1
        },
        {
          fromCurrency: 'FBTC',
          toCurrency: 'BTC',
          rate: 1
        },
        {
          fromCurrency: 'FETH',
          toCurrency: 'ETH',
          rate: 1
        },
        // MAI Finance
        {
          fromCurrency: 'MAI',
          toCurrency: 'iso:USD',
          rate: 1
        },
        // AVAX wrapped tokens:
        {
          fromCurrency: 'BUSD.e',
          toCurrency: 'BUSD',
          rate: 1
        },
        {
          fromCurrency: 'DAI.e',
          toCurrency: 'DAI',
          rate: 1
        },
        {
          fromCurrency: 'LINK.e',
          toCurrency: 'LINK',
          rate: 1
        },
        {
          fromCurrency: 'UNI.e',
          toCurrency: 'UNI',
          rate: 1
        },
        {
          fromCurrency: 'USDC.e',
          toCurrency: 'USDC',
          rate: 1
        },
        {
          fromCurrency: 'USDT.e',
          toCurrency: 'USDT',
          rate: 1
        },
        {
          fromCurrency: 'WBTC.e',
          toCurrency: 'WBTC',
          rate: 1
        }
      ]
      return pairs
    }
  }
}
