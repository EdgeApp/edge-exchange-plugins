import { makeConfig } from 'cleaner-config'
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
  EdgeAccount,
  EdgeContext,
  EdgeCurrencyWallet,
  EdgeSwapQuote,
  EdgeSwapRequest,
  lockEdgeCorePlugins,
  makeEdgeContext,
  makeFakeEdgeWorld
} from 'edge-core-js'
import accountBasedPlugins from 'edge-currency-accountbased'
import currencyPlugins from 'edge-currency-plugins'
import fs from 'fs'

import edgeExchangePlugins from '../src'
import { getTokenId } from '../src/util/swapHelpers'
import { arrrCurrencyInfo } from './fakeArrrInfo'
import { makeFakePlugin } from './fakeCurrencyPlugin'
import { asTestConfig } from './testconfig'

const DUMP_USER_FILE = './test/fakeUserDump.json'
const config = makeConfig(asTestConfig, './testconfig.json')

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

interface FetchQuoteParams {
  fromWallet: EdgeCurrencyWallet
  toWallet: EdgeCurrencyWallet
  fromCurrencyCode: string
  toCurrencyCode: string
  quoteFor: 'from' | 'to'
  exchangeAmount?: string
  nativeAmount?: string
}

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

  const userFile = fs.readFileSync(DUMP_USER_FILE, { encoding: 'utf8' })
  const json = JSON.parse(userFile)
  const dump = asUserDump(json)
  const loginKey = dump.loginKey
  const fakeUsers = [dump.data]

  const {
    YOLO_DUMP,
    YOLO_KEY,
    YOLO_PIN,
    YOLO_PASSWORD,
    YOLO_OTPKEY,
    YOLO_USERNAME
  } = config

  const contextOpts = {
    apiKey: '',
    appId: '',
    plugins: {
      bitcoin: true,
      bitcoincash: true,
      ethereum: config.ETHEREUM_INIT,
      avalanche: config.AVALANCHE_INIT,
      lifi: config.LIFI_INIT,
      polygon: config.POLYGON_INIT,
      piratechain: true,
      rango: config.RANGO_INIT,
      thorchain: config.THORCHAIN_INIT,
      swapkit: config.THORCHAIN_INIT
    }
  }

  let account: EdgeAccount | undefined
  let context: EdgeContext
  if (YOLO_DUMP) {
    const world = await makeFakeEdgeWorld(fakeUsers, {})
    context = await world.makeEdgeContext({
      ...contextOpts,
      allowNetworkAccess: true
    })
    account = await context.loginWithKey('bob', loginKey, {
      pauseWallets: true
    })
  } else {
    context = await makeEdgeContext(contextOpts)
    if (YOLO_USERNAME == null) {
      throw new Error('No username')
    }
    if (YOLO_KEY != null) {
      account = await context.loginWithKey(YOLO_USERNAME, YOLO_KEY, {
        pauseWallets: true
      })
    } else if (YOLO_PIN != null) {
      account = await context.loginWithPIN(YOLO_USERNAME, YOLO_PIN, {
        pauseWallets: true
      })
    } else if (YOLO_PASSWORD != null) {
      account = await context.loginWithPassword(YOLO_USERNAME, YOLO_PASSWORD, {
        otpKey: YOLO_OTPKEY,
        pauseWallets: true
      })
    }
    if (account == null) {
      throw new Error('No account')
    }
  }
  await context.changeLogSettings({
    defaultLogLevel: 'info',
    sources: {}
  })

  // Uncomment the following lines to get the loginKey for an account. This can be
  // used in the testconfig.json to quickly login to a real account.
  // const lk = await account.getLoginKey()
  // console.log(`Login key: ${lk}`)
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
  await ethWallet.changePaused(false)
  await avaxWallet.changePaused(false)

  const fetchQuote = async ({
    fromWallet,
    toWallet,
    fromCurrencyCode,
    toCurrencyCode,
    quoteFor,
    exchangeAmount,
    nativeAmount
  }: FetchQuoteParams): Promise<EdgeSwapQuote | null> => {
    console.log(`Request: ${fromCurrencyCode} to ${toCurrencyCode}`)
    if (exchangeAmount != null) {
      console.log(`Amount: ${quoteFor} ${exchangeAmount}`)
      if (quoteFor === 'from') {
        nativeAmount = await fromWallet.denominationToNative(
          exchangeAmount,
          fromCurrencyCode
        )
      } else {
        nativeAmount = await toWallet.denominationToNative(
          exchangeAmount,
          toCurrencyCode
        )
      }
    } else if (nativeAmount != null) {
      console.log(`Request: ${fromCurrencyCode} to ${toCurrencyCode}`)
      console.log(`Amount: ${quoteFor} nativeAmount: ${nativeAmount}`)
    } else {
      throw new Error('No nativeAmount or exchangeAmount')
    }

    const fromTokenId = getTokenId(fromWallet, fromCurrencyCode)
    const toTokenId = getTokenId(toWallet, toCurrencyCode)

    const request: EdgeSwapRequest = {
      fromWallet,
      toWallet,
      fromTokenId,
      toTokenId,
      nativeAmount,
      quoteFor
    }
    if (account == null) {
      throw new Error('No account')
    }
    const quote = await account.fetchSwapQuote(request).catch(e => {
      console.log(e)
      console.log(e.message)
      return null
    })
    logQuote(quote)
    console.log(`-----------------------------`)
    return quote
  }

  await fetchQuote({
    fromWallet: btcWallet,
    fromCurrencyCode: 'BTC',
    toWallet: ethWallet,
    toCurrencyCode: 'ETH',
    exchangeAmount: '0.002',
    quoteFor: 'from'
  })

  await fetchQuote({
    fromWallet: ethWallet,
    fromCurrencyCode: 'UNI',
    toWallet: avaxWallet,
    toCurrencyCode: 'JOE',
    exchangeAmount: '100',
    quoteFor: 'from'
  })

  await fetchQuote({
    fromWallet: arrrWallet,
    fromCurrencyCode: 'ARRR',
    toWallet: btcWallet,
    toCurrencyCode: 'BTC',
    exchangeAmount: '109',
    quoteFor: 'from'
  })

  await fetchQuote({
    fromWallet: btcWallet,
    fromCurrencyCode: 'BTC',
    toWallet: arrrWallet,
    toCurrencyCode: 'ARRR',
    exchangeAmount: '0.01',
    quoteFor: 'from'
  })

  // Test a TO quote
  await fetchQuote({
    fromWallet: ethWallet,
    fromCurrencyCode: 'ETH',
    toWallet: btcWallet,
    toCurrencyCode: 'BTC',
    exchangeAmount: '0.004',
    quoteFor: 'to'
  })

  await fetchQuote({
    fromWallet: maticWallet,
    fromCurrencyCode: 'USDC',
    toWallet: ethWallet,
    toCurrencyCode: 'WBTC',
    exchangeAmount: '4000',
    quoteFor: 'from'
  })

  const quote = await fetchQuote({
    fromWallet: bchWallet,
    fromCurrencyCode: 'BCH',
    toWallet: ethWallet,
    toCurrencyCode: 'WBTC',
    exchangeAmount: '10',
    quoteFor: 'from'
  })

  // Test a TO quote bitcoincash to ethereum:WBTC using 'to' amount from
  // previous request
  await fetchQuote({
    fromWallet: bchWallet,
    fromCurrencyCode: 'BCH',
    toWallet: ethWallet,
    toCurrencyCode: 'WBTC',
    nativeAmount: quote?.toNativeAmount ?? '0',
    // nativeAmount: await ethWallet.denominationToNative('0.15185834', 'WBTC'),
    quoteFor: 'to'
  })

  await fetchQuote({
    fromWallet: btcWallet,
    fromCurrencyCode: 'BTC',
    toWallet: bchWallet,
    toCurrencyCode: 'BCH',
    exchangeAmount: '0.2',
    quoteFor: 'from'
  })

  await fetchQuote({
    fromWallet: bchWallet,
    fromCurrencyCode: 'BCH',
    toWallet: btcWallet,
    toCurrencyCode: 'BTC',
    exchangeAmount: '0.2',
    quoteFor: 'from'
  })

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
