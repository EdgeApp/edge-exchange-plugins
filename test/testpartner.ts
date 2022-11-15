import {
  addEdgeCorePlugins,
  EdgeSwapRequest,
  lockEdgeCorePlugins,
  makeFakeEdgeWorld
} from 'edge-core-js'

import edgeExchangePlugins from '../src'
import { btcCurrencyInfo } from './fakeBtcInfo'
import { makeFakePlugin } from './fakeCurrencyPlugin'
import { ethCurrencyInfo } from './fakeEthInfo'

async function main(): Promise<void> {
  const allPlugins = {
    bitcoin: makeFakePlugin(btcCurrencyInfo),
    ethereum: makeFakePlugin(ethCurrencyInfo),
    ...edgeExchangePlugins
  }

  addEdgeCorePlugins(allPlugins)
  lockEdgeCorePlugins()

  const world = await makeFakeEdgeWorld([], {})
  const context = await world.makeEdgeContext({
    apiKey: '',
    appId: '',
    plugins: {
      bitcoin: true,
      ethereum: true,
      godex: {
        apiKey: 'XXXXX'
      }
    }
  })
  const account = await context.createAccount('bob', 'bob123', '1111')
  const btcWallet = await account.createCurrencyWallet('wallet:bitcoin', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Fake Bitcoin'
  })
  const ethWallet = await account.createCurrencyWallet('wallet:ethereum', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Fake Bitcoin'
  })
  const enabledTokens = ethWallet.currencyInfo.metaTokens.map(
    token => token.currencyCode
  )

  await ethWallet.enableTokens(enabledTokens)

  // Test a FROM quote
  const fromRequest: EdgeSwapRequest = {
    fromWallet: btcWallet,
    fromCurrencyCode: 'BTC',
    toWallet: ethWallet,
    toCurrencyCode: 'ETH',
    nativeAmount: await btcWallet.denominationToNative('0.004', 'BTC'),
    quoteFor: 'from'
  }
  console.log(`fromRequest:`)
  console.log(
    JSON.stringify(
      { ...fromRequest, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )
  console.log(`------------`)

  // Test a TO quote
  const toRequest: EdgeSwapRequest = {
    fromWallet: ethWallet,
    fromCurrencyCode: 'ETH',
    toWallet: btcWallet,
    toCurrencyCode: 'BTC',
    nativeAmount: await btcWallet.denominationToNative('0.004', 'BTC'),
    quoteFor: 'to'
  }
  console.log(`toRequest:`)
  console.log(
    JSON.stringify(
      { ...toRequest, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )

  const quote = await account.fetchSwapQuote(toRequest).catch(e => {
    console.log(e)
    console.log(e.message)
  })
  console.log(JSON.stringify(quote, null, 2))
  console.log('-------------------------')
  process.exit(0)
}

main().catch(e => {
  console.log(e.message)
  process.exit(-1)
})
