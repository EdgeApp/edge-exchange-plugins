import * as chai from 'chai'
import { assert } from 'chai'
import { before, describe, it } from 'mocha'
import chaiAsPromised from 'chai-as-promised'
import { makeMemoryDisklet } from 'disklet'
// import {
//   type EdgeAccount,
//   type EdgeContext,
//   type EdgeContextOptions,
//   type EdgeCrashReporter,
//   type EdgeFakeWorld,
//   addEdgeCorePlugins,
//   lockEdgeCorePlugins,
//   MakeEdgeContext,
//   MakeFakeEdgeWorld,
//   makeFakeEdgeWorld
// } from 'edge-core-js'
import {
  EdgeCorePlugin,
  EdgeCorePluginOptions,
  EdgeCurrencyPlugin,
  EdgeCurrencyTools,
  EdgeCurrencyWallet,
  EdgeEncodeUri,
  EdgeSwapPlugin,
  EdgeSwapRequest,
  JsonObject
} from 'edge-core-js/types'
import { makeFakeIo, makeFakeLog } from './utils'

import edgeCorePlugins from '../../../src/index'
import { setupEngine } from '../../setupEngine'
import { config } from '../../config'

chai.should()
chai.use(chaiAsPromised)

const expect = require('chai').expect

const walletHack0: any = {
  allDenominations: {
    BTC: {
      // prettier-ignore
      '100000000': {
        name: 'BTC',
        multiplier: '100000000',
        symbol: '₿'
      }
    }
  },
  denominations: [
    {
      name: 'BTC',
      multiplier: '100000000',
      symbol: '₿'
    }
  ],
  balances: { BTC: '123123' },
  blockHeight: 12345,
  currencyNames: { BTC: 'Bitcoin' },
  currencyCode: 'BTC',
  currencyInfo: {},
  displayPrivateSeed: 'private seed',
  displayPublicSeed: 'public seed',
  fiatCurrencyCode: 'iso:USD',
  id: '123',
  name: 'wallet name'
}

const walletHack1: any = {
  allDenominations: {
    BTC: {
      // prettier-ignore
      '100000000': {
        name: 'BTC',
        multiplier: '100000000',
        symbol: '₿'
      }
    }
  },
  denominations: [
    {
      name: 'BTC',
      multiplier: '100000000',
      symbol: '₿'
    }
  ],
  balances: { BTC: '123123' },
  blockHeight: 12345,
  currencyNames: { BTC: 'Bitcoin' },
  currencyCode: 'BTC',
  currencyInfo: {},
  displayPrivateSeed: 'private seed',
  displayPublicSeed: 'public seed',
  fiatCurrencyCode: 'iso:USD',
  id: '123',
  name: 'wallet name'
}
const fakeCoreWallet: EdgeCurrencyWallet = walletHack0

// async function main(): Promise<void> {

// }

// main().catch(e => console.error(e))

describe('Changelly', function () {
  it('works', async function() {
    console.log('==== Swap Test Begin ====')

    const fakeIo = makeFakeIo()
    const pluginOpts: EdgeCorePluginOptions = {
      initOptions: {apiKey: '4ac2abc529b84dd9bbfcb5653c644c80', secret: '26d6f2cf7f3086a850fd3006bf37aceb184ee4f50c3f146373ebba65ecca711b'},
      io: fakeIo,
      log: makeFakeLog(),
      nativeIo: {},
      pluginDisklet: makeMemoryDisklet()
    }
    const factory = edgeCorePlugins.changelly
    const testPlugin: EdgeSwapPlugin = factory(pluginOpts)
  
    const req: EdgeSwapRequest = {
      fromWallet: walletHack0,
      toWallet: walletHack1,
      fromCurrencyCode: walletHack0.currencyInfo.currencyCode,
      toCurrencyCode: walletHack1.currencyInfo.currencyCode,
      nativeAmount: '1000000',
      quoteFor: 'from'
    }
  
    const quote = await testPlugin.fetchSwapQuote(req, {}, {})
    console.log(quote)
  
    console.log('==== Swap Test End ====')
  })
})


// // TODO: The core will do this work itself in a future version:
// addEdgeCorePlugins(accountbased)
// addEdgeCorePlugins(exchange)
// lockEdgeCorePlugins()

// const contextOptions = { apiKey: '', appId: '', plugins: currencyPlugins }
// describe.skip('Account', () => {
//   it('has denominations that match the app default denomination settings', async () => {
//     const world: EdgeFakeWorld = await makeFakeEdgeWorld([fakeUser])
//     const context: EdgeContext = await world.makeEdgeContext(contextOptions)
//     const account: EdgeAccount = await context.loginWithPIN(
//       fakeUser.username,
//       fakeUser.pin
//     )
//     for (const key of Object.keys(SYNCED_ACCOUNT_DEFAULTS)) {
//       // $FlowFixMe
//       const defaultDenom: string | void =
//         SYNCED_ACCOUNT_DEFAULTS[key].denomination
//       if (defaultDenom) {
//         // if it's in synced settings defaults
//         // $FlowFixMe
//         const pluginId: string | void = CURRENCY_PLUGIN_NAMES[key]
//         if (pluginId) {
//           // and is a plugin
//           // check that default denom is in plugin options for denoms
//           const plugin = account.currencyConfig[pluginId]
//           const currencyInfo = plugin.currencyInfo
//           const denoms = currencyInfo.denominations
//           // const defaultDenomIndex = denoms.findIndex(
//           //   item => item.multiplier === defaultDenom
//           // )
//           // assert.toBeGreaterThan()
//           // assert.equal(defaultDenomIndex).toBeGreaterThan(-1)
//         }
//       }
//     }
//     assert.equal(account.username, 'js test 1')
//   })
// })
