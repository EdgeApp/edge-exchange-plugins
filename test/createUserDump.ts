import {
  addEdgeCorePlugins,
  EdgeFakeUser,
  lockEdgeCorePlugins,
  makeFakeEdgeWorld
} from 'edge-core-js'
import accountBasedPlugins from 'edge-currency-accountbased'
import currencyPlugins from 'edge-currency-plugins'
import fs from 'fs'

import edgeExchangePlugins from '../src'
import { arrrCurrencyInfo } from './fakeArrrInfo'
import { makeFakePlugin } from './fakeCurrencyPlugin'

const DUMP_USER_FILE = './test/fakeUserDump.json'

async function main(): Promise<void> {
  const { avalanche, ethereum, polygon } = accountBasedPlugins

  const allPlugins = {
    avalanche,
    ethereum,
    polygon,
    ...currencyPlugins,
    ...edgeExchangePlugins,
    piratechain: makeFakePlugin(arrrCurrencyInfo)
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
      bitcoincash: true,
      ethereum: true,
      avalanche: true,
      piratechain: true,
      polygon: true,
      swapkit: true,
      thorchainda: true
    }
  })
  const account = await context.createAccount({
    username: 'bob',
    password: 'bob123',
    pin: '1111'
  })
  await account.createCurrencyWallet('wallet:bitcoin', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Real Bitcoin'
  })
  await account.createCurrencyWallet('wallet:bitcoincash', {
    fiatCurrencyCode: 'iso:USD',
    name: 'My Real Bitcoin Cash'
  })
  await account.createCurrencyWallet('wallet:piratechain', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Fake Arrr'
  })
  const ethWallet = await account.createCurrencyWallet('wallet:ethereum', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Real Ethereum'
  })
  const avaxWallet = await account.createCurrencyWallet('wallet:avalanche', {
    fiatCurrencyCode: 'iso:EUR',
    name: 'My Real Avalanche'
  })
  const maticWallet = await account.createCurrencyWallet('wallet:polygon', {
    fiatCurrencyCode: 'iso:USD',
    name: 'My Real Matic'
  })
  let builtInTokens = {}
  builtInTokens = account.currencyConfig.ethereum.builtinTokens
  await ethWallet.changeEnabledTokenIds(Object.keys(builtInTokens))

  builtInTokens = account.currencyConfig.avalanche.builtinTokens
  await avaxWallet.changeEnabledTokenIds(Object.keys(builtInTokens))

  builtInTokens = account.currencyConfig.polygon.builtinTokens
  await maticWallet.changeEnabledTokenIds(Object.keys(builtInTokens))

  const data = await world.dumpFakeUser(account)
  const dump = {
    loginKey: await account.getLoginKey(),
    data
  }
  fs.writeFileSync(DUMP_USER_FILE, JSON.stringify(dump, null, 2), {
    encoding: 'utf8'
  })
  console.log('Success creating user dump')
  process.exit(0)
}

main().catch(e => {
  console.log(e.message)
  process.exit(-1)
})
