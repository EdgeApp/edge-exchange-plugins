import {
  addEdgeCorePlugins,
  EdgeFakeUser,
  lockEdgeCorePlugins,
  makeFakeEdgeWorld
} from 'edge-core-js'
import fs from 'fs'

import edgeExchangePlugins from '../src'
import { arrrCurrencyInfo } from './fakeArrrInfo'
import { avaxCurrencyInfo } from './fakeAvaxInfo'
import { btcCurrencyInfo } from './fakeBtcInfo'
import { makeFakePlugin } from './fakeCurrencyPlugin'
import { ethCurrencyInfo } from './fakeEthInfo'

const DUMP_USER_FILE = './test/fakeUserDump.json'

async function main(): Promise<void> {
  const allPlugins = {
    bitcoin: makeFakePlugin(btcCurrencyInfo),
    ethereum: makeFakePlugin(ethCurrencyInfo),
    avalanche: makeFakePlugin(avaxCurrencyInfo),
    piratechain: makeFakePlugin(arrrCurrencyInfo),
    ...edgeExchangePlugins
  }

  addEdgeCorePlugins(allPlugins)
  lockEdgeCorePlugins()

  const fakeUsers: EdgeFakeUser[] = []

  const world = await makeFakeEdgeWorld(fakeUsers, {})
  const context = await world.makeEdgeContext({
    apiKey: '',
    appId: '',
    plugins: {
      bitcoin: true,
      ethereum: true,
      avalanche: true,
      piratechain: true,
      thorchainda: true
    }
  })
  const account = await context.createAccount('bob', 'bob123', '1111')
  await account.createCurrencyWallet('wallet:bitcoin', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Fake Bitcoin'
  })
  await account.createCurrencyWallet('wallet:piratechain', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Fake Arrr'
  })
  const ethWallet = await account.createCurrencyWallet('wallet:ethereum', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Fake Bitcoin'
  })
  const avaxWallet = await account.createCurrencyWallet('wallet:avalanche', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Fake Avalanche'
  })
  const ethEnabledTokens = ethWallet.currencyInfo.metaTokens.map(
    token => token.currencyCode
  )
  await ethWallet.enableTokens(ethEnabledTokens)

  const avaxEnabledTokens = avaxWallet.currencyInfo.metaTokens.map(
    token => token.currencyCode
  )
  await avaxWallet.enableTokens(avaxEnabledTokens)

  const data = await world.dumpFakeUser(account)
  const dump = {
    loginKey: account.loginKey,
    data
  }
  fs.writeFileSync(DUMP_USER_FILE, JSON.stringify(dump), { encoding: 'utf8' })
  process.exit(0)
}

main().catch(e => {
  console.log(e.message)
  process.exit(-1)
})
