import { EdgeCurrencyInfo } from 'edge-core-js'

import { FakeSettings } from './fakeCurrencyPlugin'

const defaultSettings: FakeSettings = {
  customFeeSettings: ['gasLimit', 'gasPrice'],
  publicAddress:
    'zs15f7lcslcxuvrd2wutasl35zyxp0uw9nkk75e8euuydp93qug0reuf70l48hc8fgp7ngcu8qkvcf',
  networkFee: '100000000000000',
  parentNetworkFee: '1000000000000000',
  balances: {
    ARRR: '100000' // balances in exchange amount
  }
}

export const arrrCurrencyInfo: EdgeCurrencyInfo = {
  // Basic currency information:
  currencyCode: 'ARRR',
  displayName: 'Pirate Chain',
  pluginId: 'piratechain',
  requiredConfirmations: 10,
  walletType: 'wallet:piratechain',

  defaultSettings,

  addressExplorer: 'https://explorer.pirate.black/address/%s',
  transactionExplorer: 'https://explorer.pirate.black/tx/%s',

  denominations: [
    // An array of Objects of the possible denominations for this currency
    {
      name: 'ARRR',
      multiplier: '100000000',
      symbol: 'P'
    }
  ],
  metaTokens: []
}
