import { assert } from 'chai'
import {
  asArray,
  asEither,
  asNull,
  asObject,
  asString,
  asTuple
} from 'cleaners'
import { EdgeSwapRequest, EdgeToken } from 'edge-core-js/types'
import { describe, it } from 'mocha'

import {
  MAINNET_CODE_TRANSCRIPTION as changeheroMainnetTranscription,
  swapInfo as changeheroSwapInfo
} from '../../src/swap/central/changehero'
import {
  MAINNET_CODE_TRANSCRIPTION as changenowMainnetTranscription,
  SPECIAL_MAINNET_CASES as changenowMainnetSpecialCases,
  swapInfo as changenowSwapInfo
} from '../../src/swap/central/changenow'
import {
  MAINNET_CODE_TRANSCRIPTION as letsexchangeMainnetTranscription,
  SPECIAL_MAINNET_CASES as letsexchangeMainnetSpecialCases,
  swapInfo as letsexchangeSwapInfo
} from '../../src/swap/central/letsexchange'
import {
  MAINNET_CODE_TRANSCRIPTION as nexchangeMainnetTranscription,
  swapInfo as nexchangeSwapInfo
} from '../../src/swap/central/nexchange'
import {
  MAINNET_CODE_TRANSCRIPTION as sideshiftMainnetTranscription,
  swapInfo as sideshiftSwapInfo
} from '../../src/swap/central/sideshift'
import {
  ChainCodeTickerMap,
  getChainAndTokenCodes
} from '../../src/util/swapHelpers'
import changeheroChainCodeTickerJson from './changeheroMap.json'
import changenowChainCodeTickerJson from './changenowMap.json'
import letsexchangeChainCodeTickerJson from './letsexchangeMap.json'
import nexchangeChainCodeTickerJson from './nexchangeMap.json'
import sideshiftChainCodeTickerJson from './sideshiftMap.json'

const btcWallet = {
  currencyInfo: {
    currencyCode: 'BTC',
    pluginId: 'bitcoin'
  },
  currencyConfig: {
    getTokenId: () => {
      throw new Error('unsupported')
    }
  }
}

const evmGetTokenId = async (token: EdgeToken): Promise<string> => {
  return token.networkLocation?.contractAddress.toLowerCase().replace(/^0x/, '')
}

const avaxWallet = {
  currencyInfo: {
    currencyCode: 'AVAX',
    pluginId: 'avalanche'
  },
  currencyConfig: {
    getTokenId: evmGetTokenId
  }
}
const ethWallet = {
  currencyInfo: {
    currencyCode: 'ETH',
    pluginId: 'ethereum'
  },
  currencyConfig: {
    getTokenId: evmGetTokenId
  }
}

interface Codes {
  fromCurrencyCode: string
  toCurrencyCode: string
  fromMainnetCode: string
  toMainnetCode: string
}

const getChainCodeTickerMap = (raw: any): ChainCodeTickerMap => {
  const cleanJson = asArray(
    asTuple(
      asString,
      asArray(
        asObject({
          contractAddress: asEither(asString, asNull),
          tokenCode: asString
        })
      )
    )
  )
  const clean = cleanJson(JSON.parse(JSON.stringify(raw)))
  const out = new Map()
  for (const [, value] of Object.entries(clean)) {
    const [k, v] = value
    out.set(k, new Set(v))
  }
  return out
}

const changehero = async (request: EdgeSwapRequest): Promise<Codes> => {
  const changeheroChainCodeTickerMap = getChainCodeTickerMap(
    changeheroChainCodeTickerJson
  )

  return await getChainAndTokenCodes(
    request,
    changeheroSwapInfo,
    changeheroChainCodeTickerMap,
    changeheroMainnetTranscription
  )
}
const changenow = async (request: EdgeSwapRequest): Promise<Codes> => {
  const changenowChainCodeTickerMap = getChainCodeTickerMap(
    changenowChainCodeTickerJson
  )
  return await getChainAndTokenCodes(
    request,
    changenowSwapInfo,
    changenowChainCodeTickerMap,
    changenowMainnetTranscription,
    changenowMainnetSpecialCases
  )
}
const letsexchange = async (request: EdgeSwapRequest): Promise<Codes> => {
  const letsexchangeChainCodeTickerMap = getChainCodeTickerMap(
    letsexchangeChainCodeTickerJson
  )

  return await getChainAndTokenCodes(
    request,
    letsexchangeSwapInfo,
    letsexchangeChainCodeTickerMap,
    letsexchangeMainnetTranscription,
    letsexchangeMainnetSpecialCases
  )
}
const nexchange = async (request: EdgeSwapRequest): Promise<Codes> => {
  const nexchangeChainCodeTickerMap = getChainCodeTickerMap(
    nexchangeChainCodeTickerJson
  )

  return await getChainAndTokenCodes(
    request,
    nexchangeSwapInfo,
    nexchangeChainCodeTickerMap,
    nexchangeMainnetTranscription
  )
}
const sideshift = async (request: EdgeSwapRequest): Promise<Codes> => {
  const sideshiftChainCodeTickerMap = getChainCodeTickerMap(
    sideshiftChainCodeTickerJson
  )

  return await getChainAndTokenCodes(
    request,
    sideshiftSwapInfo,
    sideshiftChainCodeTickerMap,
    sideshiftMainnetTranscription
  )
}

describe(`swap btc to eth`, function () {
  const request: EdgeSwapRequest = {
    fromTokenId: null,
    toTokenId: null,
    nativeAmount: '100000000',
    quoteFor: 'from',
    // @ts-expect-error
    fromWallet: btcWallet,
    // @ts-expect-error
    toWallet: ethWallet
  }

  it('changehero', async function () {
    const result = await changehero(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'bitcoin',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'ethereum',
      toCurrencyCode: 'ETH'
    })
  })
  it('changenow', async function () {
    const result = await changenow(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'btc',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'eth',
      toCurrencyCode: 'ETH'
    })
  })
  it('letsexchange', async function () {
    const result = await letsexchange(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'BTC',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'ETH',
      toCurrencyCode: 'ETH'
    })
  })
  it('nexchange', async function () {
    const result = await nexchange(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'BTC',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'ETH',
      toCurrencyCode: 'ETH'
    })
  })
  it('sideshift', async function () {
    const result = await sideshift(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'bitcoin',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'ethereum',
      toCurrencyCode: 'ETH'
    })
  })
})

describe(`swap btc to avax`, function () {
  const request: EdgeSwapRequest = {
    fromTokenId: null,
    toTokenId: null,
    nativeAmount: '100000000',
    quoteFor: 'from',
    // @ts-expect-error
    fromWallet: btcWallet,
    // @ts-expect-error
    toWallet: avaxWallet
  }

  it('changehero', async function () {
    const result = await changehero(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'bitcoin',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'avalanche_(c-chain)',
      toCurrencyCode: 'AVAX'
    })
  })
  it('changenow', async function () {
    const result = await changenow(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'btc',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'cchain',
      toCurrencyCode: 'avax'
    })
  })
  it('letsexchange', async function () {
    const result = await letsexchange(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'BTC',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'AVAXC',
      toCurrencyCode: 'AVAX'
    })
  })
  it('nexchange', async function () {
    const result = await nexchange(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'BTC',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'AVAXC',
      toCurrencyCode: 'AVAX'
    })
  })
  it('sideshift', async function () {
    const result = await sideshift(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'bitcoin',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'avax',
      toCurrencyCode: 'AVAX'
    })
  })
})

describe(`swap btc to usdt (avax c-chain)`, function () {
  const request: EdgeSwapRequest = {
    fromTokenId: null,
    toTokenId: '9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
    nativeAmount: '100000000',
    quoteFor: 'from',
    // @ts-expect-error
    fromWallet: btcWallet,
    // @ts-expect-error
    toWallet: avaxWallet
  }

  it('changehero', async function () {
    const result = await changehero(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'bitcoin',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'avalanche_(c-chain)',
      toCurrencyCode: 'usdtavaxc'
    })
  })
  it('changenow', async function () {
    const result = await changenow(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'btc',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'avaxc',
      toCurrencyCode: 'usdt'
    })
  })
  it('letsexchange', async function () {
    const result = await letsexchange(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'BTC',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'AVAXC',
      toCurrencyCode: 'USDT'
    })
  })
  it('nexchange', async function () {
    const result = await nexchange(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'BTC',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'AVAXC',
      toCurrencyCode: 'USDT'
    })
  })
  it('sideshift', async function () {
    const result = await sideshift(request)
    return assert.deepEqual(result, {
      fromMainnetCode: 'bitcoin',
      fromCurrencyCode: 'BTC',
      toMainnetCode: 'avax',
      toCurrencyCode: 'USDT'
    })
  })
})
