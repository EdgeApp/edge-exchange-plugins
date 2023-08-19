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
  EdgeSwapQuote,
  EdgeSwapRequest,
  lockEdgeCorePlugins,
  makeFakeEdgeWorld
} from 'edge-core-js'
import fs from 'fs'

import edgeExchangePlugins from '../src'
import { arrrCurrencyInfo } from './fakeArrrInfo'
import { avaxCurrencyInfo } from './fakeAvaxInfo'
import { bchCurrencyInfo } from './fakeBchInfo'
import { btcCurrencyInfo } from './fakeBtcInfo'
import { makeFakePlugin } from './fakeCurrencyPlugin'
import { ethCurrencyInfo } from './fakeEthInfo'
import { polygonCurrencyInfo } from './fakePolygonInfo'

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
    bitcoincash: makeFakePlugin(bchCurrencyInfo),
    ethereum: makeFakePlugin(ethCurrencyInfo),
    polygon: makeFakePlugin(polygonCurrencyInfo),
    avalanche: makeFakePlugin(avaxCurrencyInfo),
    piratechain: makeFakePlugin(arrrCurrencyInfo),
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
    allowNetworkAccess: true,
    apiKey: '',
    appId: '',
    plugins: {
      bitcoin: true,
      bitcoincash: true,
      ethereum: true,
      avalanche: true,
      lifi: true,
      polygon: true,
      piratechain: true,
      thorchain: true
      // thorchainda: true,
      // letsexchange: {
      //   apiKey: '',
      //   affiliateId: ''
      // }
    }
  })

  const account = await context.loginWithKey('bob', loginKey)
  const btcInfo = await account.getFirstWalletInfo('wallet:bitcoin')
  const bchInfo = await account.getFirstWalletInfo('wallet:bitcoincash')
  const ethInfo = await account.getFirstWalletInfo('wallet:ethereum')
  const avaxInfo = await account.getFirstWalletInfo('wallet:avalanche')
  const arrrInfo = await account.getFirstWalletInfo('wallet:piratechain')
  const maticInfo = await account.getFirstWalletInfo('wallet:polygon')

  const btcWallet = await account.waitForCurrencyWallet(btcInfo?.id ?? '')
  const bchWallet = await account.waitForCurrencyWallet(bchInfo?.id ?? '')
  const ethWallet = await account.waitForCurrencyWallet(ethInfo?.id ?? '')
  const avaxWallet = await account.waitForCurrencyWallet(avaxInfo?.id ?? '')
  const arrrWallet = await account.waitForCurrencyWallet(arrrInfo?.id ?? '')
  const maticWallet = await account.waitForCurrencyWallet(maticInfo?.id ?? '')

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

  // Test a FROM ARRR to BTC quote
  const fromRequest2: EdgeSwapRequest = {
    fromWallet: arrrWallet,
    fromCurrencyCode: 'ARRR',
    toWallet: btcWallet,
    toCurrencyCode: 'BTC',
    nativeAmount: await arrrWallet.denominationToNative('109', 'ARRR'),
    quoteFor: 'from'
  }
  console.log(`fromRequest2:`)
  console.log(
    JSON.stringify(
      { ...fromRequest2, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )
  console.log(`------------`)

  // Test a FROM BTC to ARRR quote
  const fromRequest3: EdgeSwapRequest = {
    fromWallet: btcWallet,
    fromCurrencyCode: 'BTC',
    toWallet: arrrWallet,
    toCurrencyCode: 'ARRR',
    nativeAmount: await btcWallet.denominationToNative('0.01', 'BTC'),
    quoteFor: 'from'
  }
  console.log(`fromRequest3:`)
  console.log(
    JSON.stringify(
      { ...fromRequest3, fromWallet: undefined, toWallet: undefined },
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

  // Test a FROM quote polygon:USDC to ethereum:WBTC
  const fromRequest4: EdgeSwapRequest = {
    fromWallet: maticWallet,
    fromCurrencyCode: 'USDC',
    toWallet: ethWallet,
    toCurrencyCode: 'WBTC',
    nativeAmount: await maticWallet.denominationToNative('4000', 'USDC'),
    quoteFor: 'from'
  }
  console.log(`fromRequest4:`)
  console.log(
    JSON.stringify(
      { ...fromRequest4, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )
  console.log(`------------`)

  // Test a FROM quote bitcoincash to ethereum:WBTC
  const fromRequest5: EdgeSwapRequest = {
    fromWallet: bchWallet,
    fromCurrencyCode: 'BCH',
    toWallet: ethWallet,
    toCurrencyCode: 'WBTC',
    nativeAmount: await bchWallet.denominationToNative('10', 'BCH'),
    quoteFor: 'from'
  }
  console.log(`fromRequest5:`)
  console.log(
    JSON.stringify(
      { ...fromRequest5, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )

  const quote5 = await account.fetchSwapQuote(fromRequest5).catch(e => {
    console.log(e)
    console.log(e.message)
    return null
  })
  logQuote(quote5)
  console.log(`------------`)

  // Test a TO quote bitcoincash to ethereum:WBTC using 'to' amount from
  // previous request
  const toRequest6: EdgeSwapRequest = {
    fromWallet: bchWallet,
    fromCurrencyCode: 'BCH',
    toWallet: ethWallet,
    toCurrencyCode: 'WBTC',
    nativeAmount: quote5?.toNativeAmount ?? '0',
    // nativeAmount: await ethWallet.denominationToNative('0.15185834', 'WBTC'),
    quoteFor: 'to'
  }
  console.log(`toRequest6:`)
  console.log(
    JSON.stringify(
      { ...toRequest6, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )

  const quote6 = await account.fetchSwapQuote(toRequest6).catch(e => {
    console.log(e)
    console.log(e.message)
    return null
  })
  logQuote(quote6)
  console.log('-------------------------')

  // Test a FROM quote bitcoin to bitcoincash
  const fromRequest7: EdgeSwapRequest = {
    fromWallet: btcWallet,
    fromCurrencyCode: 'BTC',
    toWallet: bchWallet,
    toCurrencyCode: 'BCH',
    nativeAmount: await btcWallet.denominationToNative('0.2', 'BTC'),
    quoteFor: 'from'
  }
  console.log(`fromRequest7:`)
  console.log(
    JSON.stringify(
      { ...fromRequest7, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )

  const quote7 = await account.fetchSwapQuote(fromRequest7).catch(e => {
    console.log(e)
    console.log(e.message)
    return null
  })
  logQuote(quote7)
  console.log(`------------`)

  // Test a FROM quote bitcoincash to bitcoin
  const fromRequest8: EdgeSwapRequest = {
    fromWallet: bchWallet,
    fromCurrencyCode: 'BCH',
    toWallet: btcWallet,
    toCurrencyCode: 'BTC',
    nativeAmount: await bchWallet.denominationToNative('0.2', 'BCH'),
    quoteFor: 'from'
  }
  console.log(`fromRequest8:`)
  console.log(
    JSON.stringify(
      { ...fromRequest8, fromWallet: undefined, toWallet: undefined },
      null,
      2
    )
  )

  const quote8 = await account.fetchSwapQuote(fromRequest8).catch(e => {
    console.log(e)
    console.log(e.message)
    return null
  })
  logQuote(quote8)
  console.log(`------------`)

  process.exit(0)
}

const logQuote = (quote: EdgeSwapQuote | null): void => {
  if (quote == null) {
    console.log('null quote')
    return
  }
  const loggedQuote = quote as any
  loggedQuote.request.fromWallet = null
  loggedQuote.request.toWallet = null
  console.log(JSON.stringify(loggedQuote, null, 2))
}

main().catch(e => {
  console.log(e.message)
  process.exit(-1)
})
