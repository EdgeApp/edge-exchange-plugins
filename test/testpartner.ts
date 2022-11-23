import {
  asDate,
  asMap,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import {
  addEdgeCorePlugins,
  EdgeSwapRequest,
  lockEdgeCorePlugins,
  makeFakeEdgeWorld
} from 'edge-core-js'
import fs from 'fs'

import edgeExchangePlugins from '../src'
import { avaxCurrencyInfo } from './fakeAvaxInfo'
import { btcCurrencyInfo } from './fakeBtcInfo'
import { makeFakePlugin } from './fakeCurrencyPlugin'
import { ethCurrencyInfo } from './fakeEthInfo'

const DUMP_USER_FILE = './test/fakeUserDump.json'

const asFakeUser = asObject({
  username: asString,
  lastLogin: asOptional(asDate),
  loginId: asString,
  loginKey: asString,
  repos: asMap(asMap(asUnknown)),
  server: asUnknown
})

const asUserDump = asObject({
  loginKey: asString,
  data: asFakeUser
})

async function main(): Promise<void> {
  const allPlugins = {
    bitcoin: makeFakePlugin(btcCurrencyInfo),
    ethereum: makeFakePlugin(ethCurrencyInfo),
    avalanche: makeFakePlugin(avaxCurrencyInfo),
    ...edgeExchangePlugins
  }

  addEdgeCorePlugins(allPlugins)
  lockEdgeCorePlugins()

  const userFile = fs.readFileSync(DUMP_USER_FILE, { encoding: 'utf8' })
  const json = JSON.parse(userFile)
  const dump = asUserDump(json)
  const loginKey = dump.loginKey
  const fakeUsers = [dump.data]

  const world = await makeFakeEdgeWorld(fakeUsers, {})
  const context = await world.makeEdgeContext({
    apiKey: '',
    appId: '',
    plugins: {
      bitcoin: true,
      ethereum: true,
      avalanche: true,
      thorchainda: true
    }
  })

  const account = await context.loginWithKey('bob', loginKey)
  const btcInfo = await account.getFirstWalletInfo('wallet:bitcoin')
  const ethInfo = await account.getFirstWalletInfo('wallet:ethereum')
  const avaxInfo = await account.getFirstWalletInfo('wallet:avalanche')

  const btcWallet = await account.waitForCurrencyWallet(btcInfo?.id ?? '')
  const ethWallet = await account.waitForCurrencyWallet(ethInfo?.id ?? '')
  const avaxWallet = await account.waitForCurrencyWallet(avaxInfo?.id ?? '')

  // Test a FROM quote
  const fromRequest: EdgeSwapRequest = {
    fromWallet: ethWallet,
    fromCurrencyCode: 'UNI',
    toWallet: avaxWallet,
    toCurrencyCode: 'JOE',
    nativeAmount: await ethWallet.denominationToNative('100', 'UNI'),
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

  const quote = await account.fetchSwapQuote(fromRequest).catch(e => {
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
